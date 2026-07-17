#!/bin/sh
# AFCT Dashboard installer and operations helper.
#
# This script intentionally targets POSIX /bin/sh so it works with dash, ash,
# Bash in POSIX mode, and the default shell supplied by common Linux systems.
#
# Guided installation:
#   sh install.sh
#
# Unattended installation:
#   ADMIN_EMAIL=admin@example.edu \
#   ADMIN_PASSWORD_FILE=/run/secrets/afct-admin-password \
#   APP_URL=https://afct.example.edu \
#     sh install.sh --non-interactive
#
# Operational commands:
#   sh install.sh status
#   sh install.sh logs
#   sh install.sh update
#   sh install.sh restart
#   sh install.sh stop
#   sh install.sh doctor
#   sh install.sh diagnostics

set -eu
umask 077

# --------------------------------------------------------------------------- #
# Installer configuration
# --------------------------------------------------------------------------- #
INSTALLER_VERSION="2.1.1"

INVOCATION_DIR=$(pwd -P 2>/dev/null || pwd)
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

COMPOSE_FILE=${AFCT_COMPOSE_FILE:-docker-compose.yml}
ENV_FILE=${AFCT_ENV_FILE:-.env.production}
ENV_EXAMPLE=${AFCT_ENV_EXAMPLE:-.env.production.example}
LOG_FILE=${AFCT_LOG_FILE:-install.log}
# Where `self-update` fetches the deploy bundle (installer, compose file, env
# template) from. Points at the public repo's deploy directory; override for a fork
# or mirror.
INSTALLER_BASE_URL=${AFCT_INSTALLER_BASE_URL:-https://raw.githubusercontent.com/PennStateCS/AFCT/main/deploy}
APP_SERVICE=${AFCT_APP_SERVICE:-app}
UPDATER_SERVICE=${AFCT_UPDATER_SERVICE:-updater}
HEALTH_PATH=${AFCT_HEALTH_PATH:-/api/health}
HEALTH_TIMEOUT=${AFCT_HEALTH_TIMEOUT:-300}
HEALTH_INTERVAL=${AFCT_HEALTH_INTERVAL:-5}
DIAG_PREFIX="afct-diagnostics"
LOCK_KEY=$(printf '%s' "$SCRIPT_DIR" | cksum 2>/dev/null | awk '{ print $1 }')
[ -n "$LOCK_KEY" ] || LOCK_KEY="default"
LOCK_DIR="${TMPDIR:-/tmp}/afct-installer-${LOCK_KEY}.lock"

MODE="install"
MODE_SET="false"
ASSUME_YES="false"
NON_INTERACTIVE="false"
FORCE_RECONFIGURE="false"
WITH_UPDATER="false"
COLOR_ENABLED="false"
COLOR_FORCED_OFF="false"
LOG_ENABLED="false"
DOCKER_SUDO=""
COMPOSE_KIND=""
OS=$(uname -s 2>/dev/null || printf 'unknown')

DIAG_ON_EXIT="false"
DIAG_IN_PROGRESS="false"
TTY_ECHO_DISABLED="false"
LOCK_HELD="false"

TMP_ENV=""
DOCKER_INSTALL_SCRIPT=""
DOCKER_INSTALL_OUTPUT=""
PULL_OUTPUT=""
UPDATE_IMAGE_SNAPSHOT=""
DIAG_WORK=""

# --------------------------------------------------------------------------- #
# Usage and argument parsing
# --------------------------------------------------------------------------- #
usage() {
  cat <<'EOF'
AFCT Dashboard installer

Usage:
  sh install.sh [command] [options]

Commands:
  install       Run the guided installer. This is the default command.
  status        Show container and application health status.
  logs          Follow application logs. Press Ctrl+C to stop.
  update        Pull the latest images, recreate the stack, and verify health.
  self-update   Re-download the installer, compose file, and env template from the
                repository. Does not touch .env.production or data. Run before
                `update` when a release changes the compose file or the updater.
  restart       Recreate the stack without pulling new images.
  stop          Stop the stack without deleting its data volumes.
  enable-updater  Enable the in-app updater sidecar (in-app upgrades/downgrades).
                  It holds the Docker socket, so it is off by default.
  disable-updater Stop and remove the updater sidecar.
  doctor        Run a comprehensive, read-only system check.
  recover       Restore the newest protected .env.production backup.
  diagnostics   Create a support archive with known secrets redacted.
  version       Show installer and deployed application version information.
  help          Show this help.

Options:
  -y, --yes
      Accept confirmation prompts using their default answers. Missing values
      such as the administrator email are still requested interactively.

  --non-interactive
      Never prompt. Required values must be supplied through environment
      variables or password files. Docker and Docker Compose must already be installed.

  --reconfigure
      Rebuild .env.production even when a complete configuration already exists.
      Infrastructure credentials are preserved; this does not rotate the active
      PostgreSQL password or change an existing administrator account password.

  --with-updater
      During install, also enable the in-app updater sidecar (in-app upgrades and
      downgrades). It holds the Docker socket, so it is otherwise off by default.
      Equivalent to running `enable-updater` afterward.

  --no-color
      Disable colored terminal output.

Environment variables:
  APP_URL                 Public URL, such as https://afct.example.edu
  ADMIN_EMAIL             Initial administrator email
  ADMIN_PASSWORD          Initial administrator password
  ADMIN_PASSWORD_FILE     File containing the initial administrator password

Advanced overrides:
  AFCT_COMPOSE_FILE       Compose file name
  AFCT_INSTALLER_BASE_URL Base URL `self-update` downloads the deploy files from
  AFCT_ENV_FILE           Production environment file name
  AFCT_ENV_EXAMPLE        Environment template file name
  AFCT_LOG_FILE           Installer log file name
  AFCT_APP_SERVICE        Compose service name for the application (default: app)
  AFCT_HEALTH_PATH        HTTP health endpoint (default: /api/health)
  AFCT_HEALTH_TIMEOUT     Health timeout in seconds (default: 300)
  AFCT_HEALTH_INTERVAL    Health polling interval in seconds (default: 5)
EOF
}

set_mode() {
  _new_mode=$1
  if [ "$MODE_SET" = "true" ] && [ "$MODE" != "$_new_mode" ]; then
    printf '[afct] ERROR: choose only one command (%s and %s were supplied).\n' \
      "$MODE" "$_new_mode" >&2
    exit 2
  fi
  MODE=$_new_mode
  MODE_SET="true"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    install) set_mode "install" ;;
    status|--status) set_mode "status" ;;
    logs|--logs) set_mode "logs" ;;
    update|--update) set_mode "update" ;;
    self-update|--self-update) set_mode "self-update" ;;
    restart|--restart) set_mode "restart" ;;
    stop|--stop) set_mode "stop" ;;
    enable-updater|--enable-updater) set_mode "enable-updater" ;;
    disable-updater|--disable-updater) set_mode "disable-updater" ;;
    doctor|--doctor) set_mode "doctor" ;;
    recover|--recover) set_mode "recover" ;;
    diagnostics|--diagnostics) set_mode "diagnostics" ;;
    version|--version) set_mode "version" ;;
    help|-h|--help) set_mode "help" ;;
    -y|--yes) ASSUME_YES="true" ;;
    --non-interactive|--noninteractive) NON_INTERACTIVE="true" ;;
    --reconfigure) FORCE_RECONFIGURE="true" ;;
    --with-updater) WITH_UPDATER="true" ;;
    --no-color) COLOR_FORCED_OFF="true" ;;
    --)
      shift
      [ "$#" -eq 0 ] || {
        printf '[afct] ERROR: unexpected argument after --: %s\n' "$1" >&2
        exit 2
      }
      break
      ;;
    *)
      printf '[afct] ERROR: unknown option or command: %s\n' "$1" >&2
      printf '[afct] Run: sh install.sh --help\n' >&2
      exit 2
      ;;
  esac
  shift
done

if [ "$COLOR_FORCED_OFF" != "true" ] && [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  COLOR_ENABLED="true"
fi

# --------------------------------------------------------------------------- #
# Output and logging
# --------------------------------------------------------------------------- #
if [ "$COLOR_ENABLED" = "true" ]; then
  C_RESET=$(printf '\033[0m')
  C_BOLD=$(printf '\033[1m')
  C_BLUE=$(printf '\033[34m')
  C_GREEN=$(printf '\033[32m')
  C_YELLOW=$(printf '\033[33m')
  C_RED=$(printf '\033[31m')
else
  C_RESET=""
  C_BOLD=""
  C_BLUE=""
  C_GREEN=""
  C_YELLOW=""
  C_RED=""
fi

append_log() {
  [ "$LOG_ENABLED" = "true" ] || return 0
  printf '%s\n' "$1" >> "$LOG_FILE" 2>/dev/null || LOG_ENABLED="false"
  return 0
}

info() {
  _line="[afct] $*"
  printf '%s\n' "$_line"
  append_log "$_line"
}

success() {
  _plain="[afct] OK: $*"
  printf '%s%s%s\n' "$C_GREEN" "$_plain" "$C_RESET"
  append_log "$_plain"
}

warn() {
  _plain="[afct] WARNING: $*"
  printf '%s%s%s\n' "$C_YELLOW" "$_plain" "$C_RESET" >&2
  append_log "$_plain"
}

error() {
  _plain="[afct] ERROR: $*"
  printf '%s%s%s\n' "$C_RED" "$_plain" "$C_RESET" >&2
  append_log "$_plain"
}

heading() {
  printf '\n%s%s%s\n' "$C_BOLD$C_BLUE" "$*" "$C_RESET"
  append_log ""
  append_log "$*"
}

# Sequential step heading. A running counter (not "N of 4") so a run that skips
# configuration/review — e.g. starting an existing install — still reads 1, 2, …
# with no confusing gaps.
STEP_NUM=0
step() {
  STEP_NUM=$((STEP_NUM + 1))
  heading "Step ${STEP_NUM}: $*"
}

ask() {
  printf '%s' "$1" >&2
}

show_secret() {
  # Never route secrets through the installer log.
  if [ -c /dev/tty ] && printf '%s\n' "$*" > /dev/tty 2>/dev/null; then
    return 0
  fi
  printf '%s\n' "$*" >&2 || true
}

rotate_installer_log() {
  [ -f "$LOG_FILE" ] || return 0
  _size=$(wc -c < "$LOG_FILE" 2>/dev/null || printf '0')
  case "$_size" in ''|*[!0-9]*) return 0 ;; esac
  [ "$_size" -lt 5242880 ] && return 0

  rm -f "${LOG_FILE}.5" 2>/dev/null || true
  _n=4
  while [ "$_n" -ge 1 ]; do
    [ -f "${LOG_FILE}.${_n}" ] && mv "${LOG_FILE}.${_n}" "${LOG_FILE}.$((_n + 1))" 2>/dev/null || true
    _n=$((_n - 1))
  done
  mv "$LOG_FILE" "${LOG_FILE}.1" 2>/dev/null || return 0
  chmod 600 "${LOG_FILE}.1" 2>/dev/null || true
}

init_log() {
  rotate_installer_log
  if touch "$LOG_FILE" 2>/dev/null && chmod 600 "$LOG_FILE" 2>/dev/null; then
    LOG_ENABLED="true"
    {
      printf '\n============================================================\n'
      printf 'AFCT installer run: %s\n' \
        "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf 'unknown')"
      printf 'Installer version: %s\n' "$INSTALLER_VERSION"
      printf 'Mode: %s\n' "$MODE"
    } >> "$LOG_FILE" 2>/dev/null || LOG_ENABLED="false"
  else
    LOG_ENABLED="false"
    warn "the installer log cannot be written at ${SCRIPT_DIR}/${LOG_FILE}; continuing without file logging."
  fi
}

die() {
  error "$*"
  exit 1
}

# --------------------------------------------------------------------------- #
# Cleanup, signals, and failure diagnostics
# --------------------------------------------------------------------------- #
restore_terminal() {
  if [ "$TTY_ECHO_DISABLED" = "true" ]; then
    stty echo 2>/dev/null || true
    TTY_ECHO_DISABLED="false"
    printf '\n' >&2
  fi
}

release_lock() {
  if [ "$LOCK_HELD" = "true" ]; then
    rm -rf "$LOCK_DIR" 2>/dev/null || true
    LOCK_HELD="false"
  fi
}

cleanup_temporary_files() {
  [ -n "$TMP_ENV" ] && rm -f "$TMP_ENV" 2>/dev/null || true
  [ -n "$DOCKER_INSTALL_SCRIPT" ] && rm -f "$DOCKER_INSTALL_SCRIPT" 2>/dev/null || true
  [ -n "$DOCKER_INSTALL_OUTPUT" ] && rm -f "$DOCKER_INSTALL_OUTPUT" 2>/dev/null || true
  [ -n "$PULL_OUTPUT" ] && rm -f "$PULL_OUTPUT" 2>/dev/null || true
  [ -n "$UPDATE_IMAGE_SNAPSHOT" ] && rm -f "$UPDATE_IMAGE_SNAPSHOT" 2>/dev/null || true
  [ -n "$DIAG_WORK" ] && rm -rf "$DIAG_WORK" 2>/dev/null || true
}

on_signal() {
  _signal_status=$1
  # A user-initiated interrupt is not a crash: don't auto-collect diagnostics for it.
  DIAG_ON_EXIT="false"
  restore_terminal
  exit "$_signal_status"
}

on_exit() {
  _status=$?
  trap - 0
  restore_terminal
  release_lock

  if [ "$_status" -ne 0 ] && [ "$DIAG_ON_EXIT" = "true" ] && \
     [ "$DIAG_IN_PROGRESS" != "true" ]; then
    DIAG_IN_PROGRESS="true"
    error "operation failed with exit status ${_status}; creating a support archive..."
    collect_diagnostics "automatic" || true
  fi

  cleanup_temporary_files
  exit "$_status"
}

trap 'on_signal 130' INT
trap 'on_signal 143' TERM
trap 'on_signal 129' HUP
trap 'on_exit' 0

acquire_lock() {
  # Reentrant within a single run: a command reached from the interactive menu
  # (for example "update") must not deadlock against the lock this process holds.
  [ "$LOCK_HELD" = "true" ] && return 0

  if mkdir "$LOCK_DIR" 2>/dev/null; then
    LOCK_HELD="true"
    printf '%s\n' "$$" > "$LOCK_DIR/pid" 2>/dev/null || true
    return 0
  fi

  _lock_pid=""
  [ -f "$LOCK_DIR/pid" ] && _lock_pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  case "$_lock_pid" in
    ''|*[!0-9]*) ;;
    *)
      if kill -0 "$_lock_pid" 2>/dev/null; then
        die "another AFCT installer operation is already running (PID ${_lock_pid})."
      fi
      ;;
  esac

  warn "removing a stale installer lock."
  rm -rf "$LOCK_DIR" 2>/dev/null || die "could not remove the stale lock at ${LOCK_DIR}."
  mkdir "$LOCK_DIR" 2>/dev/null || die "could not acquire the installer lock at ${LOCK_DIR}."
  LOCK_HELD="true"
  printf '%s\n' "$$" > "$LOCK_DIR/pid" 2>/dev/null || true
}

# --------------------------------------------------------------------------- #
# Docker and Compose wrappers
# --------------------------------------------------------------------------- #
docker_cmd() {
  if [ -n "$DOCKER_SUDO" ]; then
    sudo docker "$@"
  else
    docker "$@"
  fi
}

compose_raw() {
  case "$COMPOSE_KIND" in
    v2) docker_cmd compose "$@" ;;
    v1)
      if [ -n "$DOCKER_SUDO" ]; then
        sudo docker-compose "$@"
      else
        docker-compose "$@"
      fi
      ;;
    *) return 127 ;;
  esac
}

# Emits `--profile updater` (as two words) when the in-app updater sidecar has been
# enabled, so every compose action — pull/up/ps/config/stop — includes it. Empty
# otherwise, keeping the profiled service dormant on a default install.
updater_profile_args() {
  if [ "$(read_env_value AFCT_UPDATER_ENABLED "$ENV_FILE" 2>/dev/null)" = "true" ]; then
    printf '%s' '--profile updater'
  fi
  # Always succeed: `_profile=$(updater_profile_args)` under `set -e` must not abort
  # when the updater is disabled (the bare test would otherwise return non-zero).
  return 0
}

# Use the production env file explicitly and prevent exported managed variables in
# the invoking shell from unexpectedly overriding the saved installation config.
compose_project() {
  (
    unset NODE_ENV POSTGRES_PASSWORD DATABASE_URL ADMIN_EMAIL ADMIN_PASSWORD \
      NEXTAUTH_SECRET NEXTAUTH_URL AUTH_TRUST_HOST

    # Unquoted on purpose: expands to `--profile updater` or to nothing.
    _profile=$(updater_profile_args)
    if [ -f "$ENV_FILE" ]; then
      compose_raw $_profile --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
    else
      compose_raw $_profile -f "$COMPOSE_FILE" "$@"
    fi
  )
}

detect_compose() {
  if docker_cmd compose version >/dev/null 2>&1; then
    COMPOSE_KIND="v2"
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_KIND="v1"
    return 0
  fi
  COMPOSE_KIND=""
  return 1
}

resolve_docker_access() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. Run: sh install.sh"

  if docker info >/dev/null 2>&1; then
    DOCKER_SUDO=""
  elif [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1; then
    if [ "$NON_INTERACTIVE" = "true" ]; then
      if sudo -n docker info >/dev/null 2>&1; then
        DOCKER_SUDO="sudo"
      else
        die "Docker requires elevated access, but passwordless sudo is unavailable in non-interactive mode."
      fi
    else
      info "Docker requires elevated access; sudo may ask for your password."
      if sudo docker info >/dev/null 2>&1; then
        DOCKER_SUDO="sudo"
      else
        die "Docker is installed, but its daemon is not reachable. Start Docker and try again."
      fi
    fi
  else
    die "Docker is installed, but its daemon is not reachable. Start Docker and try again."
  fi

  detect_compose || return 1
  return 0
}

# Diagnostics must remain useful even when Docker is broken. This variant never
# prompts and never fails the caller.
resolve_docker_access_soft() {
  command -v docker >/dev/null 2>&1 || return 1

  # Resolve into a local first and only publish the globals on success. Failing
  # here must NOT clobber access that a prior resolve_docker_access already
  # established (e.g. sudo obtained interactively, where sudo -n now fails).
  _soft_sudo=""
  if docker info >/dev/null 2>&1; then
    _soft_sudo=""
  elif [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1 && \
       sudo -n docker info >/dev/null 2>&1; then
    _soft_sudo="sudo"
  else
    return 1
  fi

  DOCKER_SUDO=$_soft_sudo
  COMPOSE_KIND=""
  detect_compose || true
  return 0
}

# --------------------------------------------------------------------------- #
# Prompt helpers and validation
# --------------------------------------------------------------------------- #
can_prompt() {
  [ "$NON_INTERACTIVE" != "true" ] && [ -t 0 ]
}

prompt_default() {
  _question=$1
  _default=$2

  if ! can_prompt; then
    printf '%s' "$_default"
    return 0
  fi

  ask "${_question} [${_default}]: "
  IFS= read -r _answer || _answer=""
  [ -n "$_answer" ] && printf '%s' "$_answer" || printf '%s' "$_default"
}

prompt_required() {
  _question=$1
  can_prompt || return 1

  while :; do
    ask "${_question}: "
    if ! IFS= read -r _answer; then
      return 1
    fi
    [ -n "$_answer" ] && {
      printf '%s' "$_answer"
      return 0
    }
    warn "a value is required."
  done
}

prompt_secret() {
  _question=$1
  can_prompt || return 1

  ask "${_question}: "
  if stty -echo 2>/dev/null; then
    TTY_ECHO_DISABLED="true"
  fi

  if ! IFS= read -r _answer; then
    restore_terminal
    return 1
  fi

  restore_terminal
  printf '%s' "$_answer"
}

confirm() {
  _question=$1
  _default=${2:-y}

  if [ "$ASSUME_YES" = "true" ]; then
    _answer=$_default
  else
    _answer=$(prompt_default "$_question" "$_default")
  fi

  case "$_answer" in
    y|Y|yes|YES|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

require_value() {
  [ -n "$1" ] || die "$2"
}

is_positive_integer() {
  case "$1" in
    ''|*[!0-9]*|0) return 1 ;;
    *) return 0 ;;
  esac
}

is_email() {
  case "$1" in
    *[[:space:]]*|*@*@*) return 1 ;;
    ?*@?*.?*) return 0 ;;
    *) return 1 ;;
  esac
}

normalize_app_url() {
  _url=$1

  case "$_url" in
    *[[:space:]]*) return 1 ;;
    http://*) _scheme="http" ;;
    https://*) _scheme="https" ;;
    *) return 1 ;;
  esac

  _authority=${_url#*://}
  while [ "${_authority%/}" != "$_authority" ]; do
    _authority=${_authority%/}
  done

  [ -n "$_authority" ] || return 1
  case "$_authority" in
    */*|*\?*|*\#*|*@*) return 1 ;;
  esac

  case "$_authority" in
    \[*\]*) _host=$_authority ;;
    *) _host=${_authority%%:*} ;;
  esac
  [ -n "$_host" ] || return 1

  printf '%s://%s' "$_scheme" "$_authority"
}

warn_for_app_url() {
  _url=$1
  _without_scheme=${_url#*://}
  _hostport=${_without_scheme%%/*}
  _host=${_hostport%%:*}

  case "$_url" in
    https://*) ;;
    http://localhost*|http://127.0.0.1*|http://\[::1\]*) ;;
    *) warn "the public URL is not HTTPS. Authentication cookies and redirects may not work safely in production." ;;
  esac

  if printf '%s' "$_host" | grep -Eq '^[0-9]+(\.[0-9]+){3}$'; then
    warn "the public URL uses a bare IPv4 address. A hostname with a matching TLS certificate is strongly recommended."
  fi
}

is_strong_password() {
  _password=$1
  [ "${#_password}" -ge 8 ] && [ "${#_password}" -le 72 ] || return 1
  printf '%s' "$_password" | grep -q '[A-Z]' || return 1
  printf '%s' "$_password" | grep -q '[a-z]' || return 1
  printf '%s' "$_password" | grep -q '[0-9]' || return 1
  printf '%s' "$_password" | grep -q '[^A-Za-z0-9]' || return 1
  return 0
}

# Values are written unquoted into the env file (see write_env_assignment), which
# both legacy docker-compose v1 and modern Compose v2 read literally to end-of-line.
# Reject the inputs that would be reinterpreted rather than stored verbatim:
# quotes/backslashes (ambiguous quoting), line breaks, tabs, leading/trailing
# spaces (v2 trims them), and a space before '#' (v2 treats it as an inline comment).
is_env_value_safe() {
  _cr=$(printf '\r')
  _tab=$(printf '\t')
  case "$1" in
    *"'"*) return 1 ;;
    *'"'*) return 1 ;;
    *\\*) return 1 ;;
    *"$_cr"*) return 1 ;;
    *"$_tab"*) return 1 ;;
  esac
  case "$1" in
    *"
"*) return 1 ;;
  esac
  case "$1" in
    ' '*|*' ') return 1 ;;
    *' #'*) return 1 ;;
  esac
  return 0
}

read_password_source() {
  if [ -n "${ADMIN_PASSWORD:-}" ] && [ -n "${ADMIN_PASSWORD_FILE:-}" ]; then
    die "set only one of ADMIN_PASSWORD or ADMIN_PASSWORD_FILE."
  fi

  if [ -n "${ADMIN_PASSWORD_FILE:-}" ]; then
    case "$ADMIN_PASSWORD_FILE" in
      /*) _password_file=$ADMIN_PASSWORD_FILE ;;
      *) _password_file=${INVOCATION_DIR}/${ADMIN_PASSWORD_FILE} ;;
    esac
    [ -f "$_password_file" ] || die "ADMIN_PASSWORD_FILE does not exist: ${ADMIN_PASSWORD_FILE}"
    [ -r "$_password_file" ] || die "ADMIN_PASSWORD_FILE is not readable: ${ADMIN_PASSWORD_FILE}"
    _password_from_file=$(cat "$_password_file")
    printf '%s' "$_password_from_file"
    return 0
  fi

  printf '%s' "${ADMIN_PASSWORD:-}"
}

# --------------------------------------------------------------------------- #
# Environment-file helpers
# --------------------------------------------------------------------------- #
env_file_complete() {
  _file=$1
  [ -s "$_file" ] || return 1

  for _key in POSTGRES_PASSWORD DATABASE_URL NEXTAUTH_SECRET NEXTAUTH_URL; do
    grep -qE "^[[:space:]]*${_key}=.+" "$_file" 2>/dev/null || return 1
  done
  return 0
}

read_env_value() {
  _key=$1
  _file=$2
  [ -f "$_file" ] || return 0

  _raw=$(awk -v key="$_key" '
    {
      line = $0
      sub(/^[[:space:]]*/, "", line)
      if (index(line, key "=") == 1) {
        print substr(line, length(key) + 2)
        exit
      }
    }
  ' "$_file" 2>/dev/null || true)

  case "$_raw" in
    \'*)
      case "$_raw" in *\') _raw=${_raw#\'}; _raw=${_raw%\'} ;; esac
      ;;
    \"*)
      case "$_raw" in *\") _raw=${_raw#\"}; _raw=${_raw%\"} ;; esac
      ;;
  esac

  printf '%s' "$_raw"
}

# Set or replace a single unmanaged KEY=VALUE line in the env file, in place and
# atomically, preserving everything else. Used for the AFCT_UPDATER_ENABLED toggle.
set_env_flag() {
  _key=$1
  _val=$2
  [ -f "$ENV_FILE" ] || die "${ENV_FILE} not found. Run the installer first."
  _tmp=$(mktemp "${ENV_FILE}.tmp.XXXXXX" 2>/dev/null) || die "could not create a temporary file in ${SCRIPT_DIR}."
  if grep -qE "^${_key}=" "$ENV_FILE" 2>/dev/null; then
    awk -v k="$_key" -v v="$_val" '$0 ~ ("^" k "=") { print k "=" v; next } { print }' \
      "$ENV_FILE" > "$_tmp" || { rm -f "$_tmp"; die "could not update ${ENV_FILE}."; }
  else
    { cat "$ENV_FILE" && printf '%s=%s\n' "$_key" "$_val"; } > "$_tmp" \
      || { rm -f "$_tmp"; die "could not update ${ENV_FILE}."; }
  fi
  chmod 600 "$_tmp" 2>/dev/null || true
  mv "$_tmp" "$ENV_FILE" || { rm -f "$_tmp"; die "could not replace ${ENV_FILE}."; }
}

write_env_assignment() {
  _key=$1
  _value=$2
  is_env_value_safe "$_value" || die "${_key} contains characters that cannot be stored safely in ${ENV_FILE} (line breaks, quotes, backslashes, tabs, leading or trailing spaces, or a space before '#')."
  # Unquoted, end-of-line value: read identically by docker-compose v1 and Compose
  # v2. Quoting here would be stripped by v2 but taken literally by v1.
  printf '%s=%s\n' "$_key" "$_value"
}

backup_env_file() {
  [ -f "$ENV_FILE" ] || return 0
  _stamp=$(date +%Y%m%d-%H%M%S 2>/dev/null || printf 'previous')
  _backup="${ENV_FILE}.backup.${_stamp}.$$"
  cp "$ENV_FILE" "$_backup" || die "could not back up ${ENV_FILE}."
  chmod 600 "$_backup" 2>/dev/null || true
  info "saved the previous configuration as ${_backup}."
}

write_environment_file() {
  _base_file=""
  if [ -f "$ENV_FILE" ]; then
    _base_file=$ENV_FILE
  elif [ -f "$ENV_EXAMPLE" ]; then
    _base_file=$ENV_EXAMPLE
  fi

  TMP_ENV=$(mktemp "${ENV_FILE}.tmp.XXXXXX" 2>/dev/null) || \
    die "could not create a temporary configuration file in ${SCRIPT_DIR}."

  if [ -n "$_base_file" ]; then
    # Preserve comments and application-specific settings, but remove every key
    # managed by this installer so each appears exactly once in the final file.
    awk '
      BEGIN {
        in_managed_block = 0
        managed["NODE_ENV"] = 1
        managed["POSTGRES_PASSWORD"] = 1
        managed["DATABASE_URL"] = 1
        managed["ADMIN_EMAIL"] = 1
        managed["ADMIN_PASSWORD"] = 1
        managed["NEXTAUTH_SECRET"] = 1
        managed["NEXTAUTH_URL"] = 1
        managed["AUTH_TRUST_HOST"] = 1
      }
      /^# BEGIN AFCT INSTALLER MANAGED SETTINGS$/ {
        in_managed_block = 1
        next
      }
      /^# END AFCT INSTALLER MANAGED SETTINGS$/ {
        in_managed_block = 0
        next
      }
      in_managed_block { next }
      {
        line = $0
        sub(/^[[:space:]]*/, "", line)
        key = line
        sub(/[=:].*/, "", key)
        gsub(/[[:space:]]+$/, "", key)
        if (key in managed) next
        print
      }
    ' "$_base_file" > "$TMP_ENV"
  else
    : > "$TMP_ENV"
  fi

  {
    printf '\n# BEGIN AFCT INSTALLER MANAGED SETTINGS\n'
    printf '# Managed by AFCT install.sh %s\n' "$INSTALLER_VERSION"
    printf '# Updated: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf 'unknown')"
    printf '# Keep this file private. Reconfiguration preserves infrastructure secrets.\n'
    printf '# Change an existing administrator password from inside AFCT, not here.\n'
    write_env_assignment NODE_ENV production
    write_env_assignment POSTGRES_PASSWORD "$POSTGRES_PASSWORD_IN"
    write_env_assignment DATABASE_URL "$DATABASE_URL_IN"
    write_env_assignment ADMIN_EMAIL "$ADMIN_EMAIL_IN"
    write_env_assignment ADMIN_PASSWORD "$ADMIN_PASSWORD_IN"
    write_env_assignment NEXTAUTH_SECRET "$NEXTAUTH_SECRET_IN"
    write_env_assignment NEXTAUTH_URL "$APP_URL_IN"
    write_env_assignment AUTH_TRUST_HOST true
    printf '# END AFCT INSTALLER MANAGED SETTINGS\n'
  } >> "$TMP_ENV"

  chmod 600 "$TMP_ENV" 2>/dev/null || true
  mv "$TMP_ENV" "$ENV_FILE" || die "could not replace ${ENV_FILE}."
  TMP_ENV=""
  chmod 600 "$ENV_FILE" 2>/dev/null || true
}

# --------------------------------------------------------------------------- #
# Secret generation
# --------------------------------------------------------------------------- #
gen_secret() {
  _secret=""

  if command -v openssl >/dev/null 2>&1; then
    _secret=$(openssl rand -hex 32 2>/dev/null || true)
  elif [ -r /dev/urandom ] && command -v od >/dev/null 2>&1; then
    _secret=$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | \
      od -An -tx1 2>/dev/null | tr -d ' \n' || true)
  fi

  [ "${#_secret}" -ge 48 ] || return 1
  printf '%.48s' "$_secret"
}

gen_admin_password() {
  _core=$(gen_secret) || return 1
  printf '%sAa1!' "$_core"
}

# --------------------------------------------------------------------------- #
# Docker installation and prerequisite checks
# --------------------------------------------------------------------------- #
maybe_install_docker() {
  command -v docker >/dev/null 2>&1 && return 0

  if [ "$OS" != "Linux" ]; then
    error "Docker is not installed."
    if [ "$OS" = "Darwin" ]; then
      info "Install Docker Desktop, start it, and rerun this installer:"
      info "https://www.docker.com/products/docker-desktop/"
    fi
    die "Docker is required."
  fi

  heading "Docker is required"
  info "Docker is not installed on this host."
  info "For production, Docker's distro-specific repository instructions are recommended:"
  info "https://docs.docker.com/engine/install/"
  info "This installer can alternatively run Docker's get.docker.com convenience script."

  if [ "$NON_INTERACTIVE" = "true" ]; then
    die "Docker must be installed before a non-interactive AFCT installation."
  fi

  confirm "Install Docker using the get.docker.com convenience script?" "y" || \
    die "install Docker and rerun this script."

  _install_sudo=""
  if [ "$(id -u)" != "0" ]; then
    command -v sudo >/dev/null 2>&1 || die "installing Docker requires root or sudo."
    _install_sudo="sudo"
  fi

  DOCKER_INSTALL_SCRIPT=$(mktemp "${TMPDIR:-/tmp}/afct-get-docker.XXXXXX") || \
    die "could not create a temporary Docker installer file."
  DOCKER_INSTALL_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/afct-get-docker-output.XXXXXX") || \
    die "could not create a temporary Docker installer output file."

  info "downloading Docker's installer..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com -o "$DOCKER_INSTALL_SCRIPT" || \
      die "could not download Docker's installer."
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$DOCKER_INSTALL_SCRIPT" https://get.docker.com || \
      die "could not download Docker's installer."
  else
    die "curl or wget is required to download Docker."
  fi

  sh -n "$DOCKER_INSTALL_SCRIPT" || die "the downloaded Docker installer is not valid shell code."
  _commit=$(sed -n 's/^SCRIPT_COMMIT_SHA=["'"'"']\{0,1\}\([0-9a-f]\{7,\}\).*/\1/p' \
    "$DOCKER_INSTALL_SCRIPT" 2>/dev/null | head -n 1)
  [ -n "$_commit" ] && info "Docker installer commit: ${_commit}"

  info "installing Docker..."
  if [ -n "$_install_sudo" ]; then
    if sudo sh "$DOCKER_INSTALL_SCRIPT" > "$DOCKER_INSTALL_OUTPUT" 2>&1; then
      _install_status=0
    else
      _install_status=$?
    fi
  else
    if sh "$DOCKER_INSTALL_SCRIPT" > "$DOCKER_INSTALL_OUTPUT" 2>&1; then
      _install_status=0
    else
      _install_status=$?
    fi
  fi

  cat "$DOCKER_INSTALL_OUTPUT" >> "$LOG_FILE" 2>/dev/null || true
  if [ "$_install_status" -ne 0 ]; then
    cat "$DOCKER_INSTALL_OUTPUT" >&2 2>/dev/null || true
    die "Docker installation failed with exit status ${_install_status}."
  fi

  command -v docker >/dev/null 2>&1 || die "Docker installation completed without installing the docker command."

  if command -v systemctl >/dev/null 2>&1; then
    if [ -n "$_install_sudo" ]; then
      sudo systemctl enable --now docker >/dev/null 2>&1 || \
        warn "Docker was installed, but its system service could not be enabled automatically."
    else
      systemctl enable --now docker >/dev/null 2>&1 || \
        warn "Docker was installed, but its system service could not be enabled automatically."
    fi
  fi

  if [ "$(id -u)" != "0" ]; then
    warn "membership in the docker group grants root-equivalent control of this host."
    if confirm "Add $(id -un) to the docker group?" "y"; then
      sudo usermod -aG docker "$(id -un)" || warn "could not add $(id -un) to the docker group."
      info "docker-group membership becomes active after the next login. This run will use sudo."
    fi
  fi

  success "Docker installed."
}

install_compose_plugin() {
  [ "$OS" = "Linux" ] || die "install the Docker Compose plugin and rerun this script."

  if [ "$NON_INTERACTIVE" = "true" ]; then
    die "the Docker Compose plugin must be installed before a non-interactive installation."
  fi

  confirm "Install the Docker Compose plugin now?" "y" || \
    die "the Docker Compose plugin is required."

  _package_sudo=""
  if [ "$(id -u)" != "0" ]; then
    command -v sudo >/dev/null 2>&1 || die "installing Docker Compose requires root or sudo."
    _package_sudo="sudo"
  fi

  info "installing the Docker Compose plugin..."
  if command -v apt-get >/dev/null 2>&1; then
    if [ -n "$_package_sudo" ]; then
      sudo apt-get update -y
      sudo apt-get install -y docker-compose-plugin
    else
      apt-get update -y
      apt-get install -y docker-compose-plugin
    fi
  elif command -v dnf >/dev/null 2>&1; then
    if [ -n "$_package_sudo" ]; then
      sudo dnf install -y docker-compose-plugin
    else
      dnf install -y docker-compose-plugin
    fi
  elif command -v yum >/dev/null 2>&1; then
    if [ -n "$_package_sudo" ]; then
      sudo yum install -y docker-compose-plugin
    else
      yum install -y docker-compose-plugin
    fi
  elif command -v apk >/dev/null 2>&1; then
    if [ -n "$_package_sudo" ]; then
      sudo apk add --no-cache docker-cli-compose
    else
      apk add --no-cache docker-cli-compose
    fi
  else
    die "no supported package manager was found; install 'docker compose' manually."
  fi

  detect_compose || die "Docker Compose installation did not complete successfully."
  success "Docker Compose installed."
}

ensure_compose() {
  if detect_compose; then
    if [ "$COMPOSE_KIND" = "v1" ]; then
      warn "legacy docker-compose v1 is being used. Install the current 'docker compose' plugin when practical."
    fi
    return 0
  fi

  install_compose_plugin
}

ensure_docker_boot() {
  [ "$OS" = "Linux" ] || return 0
  command -v systemctl >/dev/null 2>&1 || return 0

  if docker_cmd info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q 'rootless'; then
    if systemctl --user is-enabled docker >/dev/null 2>&1; then
      return 0
    fi
    systemctl --user enable docker >/dev/null 2>&1 || \
      warn "rootless Docker is running, but its user service could not be enabled at login."
    return 0
  fi

  systemctl list-unit-files 2>/dev/null | grep -q '^docker\.service' || return 0
  systemctl is-enabled docker >/dev/null 2>&1 && return 0

  info "enabling Docker to start automatically after a reboot..."
  if [ "$(id -u)" = "0" ]; then
    systemctl enable docker >/dev/null 2>&1 || \
      warn "run 'systemctl enable docker' to start Docker automatically after reboot."
  elif command -v sudo >/dev/null 2>&1; then
    sudo systemctl enable docker >/dev/null 2>&1 || \
      warn "run 'sudo systemctl enable docker' to start Docker automatically after reboot."
  fi
}

port_in_use() {
  _port=$1

  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk -v port="$_port" '
      NR > 1 {
        address = $4
        sub(/.*:/, "", address)
        if (address == port) found = 1
      }
      END { exit(found ? 0 : 1) }
    '
    return $?
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$_port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  return 1
}

check_disk_space() {
  command -v df >/dev/null 2>&1 || return 0
  _available=$(df -Pk . 2>/dev/null | awk 'NR == 2 { print $4 }')
  case "$_available" in
    ''|*[!0-9]*) return 0 ;;
  esac

  if [ "$_available" -lt 5242880 ]; then
    warn "less than approximately 5 GB is free in ${SCRIPT_DIR}. Docker images may exhaust the disk."
  fi
}

check_sensitive_permissions() {
  _file=$1
  [ -f "$_file" ] || return 0
  if command -v stat >/dev/null 2>&1; then
    _mode=$(stat -c '%a' "$_file" 2>/dev/null || stat -f '%Lp' "$_file" 2>/dev/null || printf '')
    case "$_mode" in
      ''|*[!0-9]*) return 0 ;;
    esac
    _group=$(((_mode / 10) % 10))
    _other=$((_mode % 10))
    if [ "$_group" -ne 0 ] || [ "$_other" -ne 0 ]; then
      warn "${_file} is readable or writable by group/other users (mode ${_mode}); expected 600."
      return 1
    fi
  fi
  return 0
}

check_clock_sync() {
  command -v timedatectl >/dev/null 2>&1 || return 0
  _sync=$(timedatectl show -p NTPSynchronized --value 2>/dev/null || printf '')
  case "$_sync" in
    yes) return 0 ;;
    no) warn "the system clock is not synchronized. Incorrect time can break TLS and authentication."; return 1 ;;
  esac
  return 0
}

compose_volume_names() {
  compose_project config --volumes 2>/dev/null || true
}

existing_data_without_config() {
  [ -f "$ENV_FILE" ] && env_file_complete "$ENV_FILE" && return 1
  resolve_docker_access_soft || return 1
  [ -n "$COMPOSE_KIND" ] || return 1
  _volumes=$(compose_volume_names)
  [ -n "$_volumes" ] || return 1
  for _volume in $_volumes; do
    docker_cmd volume ls --format '{{.Name}}' 2>/dev/null | grep -Eq "(^|_)${_volume}$" && return 0
  done
  return 1
}

show_deployed_versions() {
  info "installer version: ${INSTALLER_VERSION}"
  resolve_docker_access_soft || return 0
  [ -n "$COMPOSE_KIND" ] || return 0
  [ -f "$COMPOSE_FILE" ] || return 0
  _app_id=$(compose_project ps -q "$APP_SERVICE" 2>/dev/null || true)
  [ -n "$_app_id" ] || return 0
  _image=$(docker_cmd inspect -f '{{.Config.Image}}' "$_app_id" 2>/dev/null || true)
  _image_id=$(docker_cmd inspect -f '{{.Image}}' "$_app_id" 2>/dev/null || true)
  [ -n "$_image" ] && info "application image: ${_image}"
  [ -n "$_image_id" ] && info "application image ID: ${_image_id}"
}


preflight() {
  step "System checks"

  [ -f "$COMPOSE_FILE" ] || die "${COMPOSE_FILE} was not found next to this script."
  [ -f "$ENV_EXAMPLE" ] || warn "${ENV_EXAMPLE} was not found; the installer will create a minimal production configuration."

  is_positive_integer "$HEALTH_TIMEOUT" || die "AFCT_HEALTH_TIMEOUT must be a positive integer."
  is_positive_integer "$HEALTH_INTERVAL" || die "AFCT_HEALTH_INTERVAL must be a positive integer."

  maybe_install_docker
  resolve_docker_access || true
  ensure_compose
  ensure_docker_boot

  _docker_version=$(docker_cmd version --format '{{.Server.Version}}' 2>/dev/null || printf 'unknown')
  _compose_version=$(compose_raw version --short 2>/dev/null || compose_raw version 2>/dev/null | head -n 1 || printf 'unknown')
  success "Docker ${_docker_version} is available."
  success "Docker Compose ${_compose_version} is available."

  if ! env_file_complete "$ENV_FILE"; then
    for _port in 80 443; do
      if port_in_use "$_port"; then
        warn "TCP port ${_port} is already in use. The AFCT web service may be unable to bind it."
      fi
    done
  fi

  check_disk_space
  check_clock_sync || true
  check_sensitive_permissions "$ENV_FILE" || true
  check_sensitive_permissions "$LOG_FILE" || true
}

# --------------------------------------------------------------------------- #
# Compose deployment and health checks
# --------------------------------------------------------------------------- #
validate_compose() {
  if [ "$LOG_ENABLED" = "true" ]; then
    if ! compose_project config >/dev/null 2>> "$LOG_FILE"; then
      die "the Docker Compose configuration is invalid. Review ${LOG_FILE}."
    fi
  else
    if ! compose_project config >/dev/null; then
      die "the Docker Compose configuration is invalid."
    fi
  fi
}

pull_images() {
  info "downloading AFCT container images..."
  PULL_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/afct-pull.XXXXXX") || \
    die "could not create temporary pull output."

  if [ -t 1 ]; then
    if compose_project pull; then
      _pull_status=0
    else
      _pull_status=$?
    fi
  else
    if [ "$COMPOSE_KIND" = "v2" ]; then
      if compose_project pull --quiet > "$PULL_OUTPUT" 2>&1; then
        _pull_status=0
      else
        _pull_status=$?
      fi
    else
      if compose_project pull > "$PULL_OUTPUT" 2>&1; then
        _pull_status=0
      else
        _pull_status=$?
      fi
    fi
    cat "$PULL_OUTPUT" >> "$LOG_FILE" 2>/dev/null || true
  fi

  if [ "$_pull_status" -ne 0 ]; then
    [ -s "$PULL_OUTPUT" ] && cat "$PULL_OUTPUT" >&2 2>/dev/null || true
    die "container images could not be downloaded. Check the network and registry authentication."
  fi

  rm -f "$PULL_OUTPUT" 2>/dev/null || true
  PULL_OUTPUT=""
  success "Container images downloaded."
}

start_stack() {
  info "starting the AFCT stack..."
  if [ "$LOG_ENABLED" = "true" ]; then
    if ! compose_project up -d >> "$LOG_FILE" 2>&1; then
      die "the AFCT stack could not be started. Review ${LOG_FILE}."
    fi
  else
    if ! compose_project up -d; then
      die "the AFCT stack could not be started."
    fi
  fi
}

http_health_responding() {
  command -v curl >/dev/null 2>&1 || return 1
  curl -kfsS --max-time 10 "https://localhost${HEALTH_PATH}" >/dev/null 2>&1 || \
    curl -kfsS --max-time 10 "http://localhost${HEALTH_PATH}" >/dev/null 2>&1
}

wait_for_health() {
  info "waiting for the application health check..."

  _elapsed=0
  while [ "$_elapsed" -lt "$HEALTH_TIMEOUT" ]; do
    _app_id=$(compose_project ps -q "$APP_SERVICE" 2>/dev/null || true)

    if [ -n "$_app_id" ]; then
      _state=$(docker_cmd inspect \
        -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
        "$_app_id" 2>/dev/null || printf 'missing|none')
      _container_state=${_state%%|*}
      _health_state=${_state#*|}

      case "${_container_state}|${_health_state}" in
        running\|healthy)
          success "The AFCT application is healthy."
          if http_health_responding; then
            success "The web service is responding at ${HEALTH_PATH}."
          else
            warn "the container is healthy, but the local web endpoint did not respond yet."
          fi
          return 0
          ;;
        running\|unhealthy)
          die "the application container reported an unhealthy state."
          ;;
        exited\|*|dead\|*)
          die "the application container stopped before becoming healthy."
          ;;
        running\|none)
          die "the ${APP_SERVICE} service has no Docker health check configured."
          ;;
      esac
    fi

    sleep "$HEALTH_INTERVAL"
    _elapsed=$((_elapsed + HEALTH_INTERVAL))
  done

  die "the application did not become healthy within ${HEALTH_TIMEOUT} seconds."
}

deploy_stack() {
  validate_compose
  pull_images
  start_stack
  wait_for_health
}

restart_stack() {
  validate_compose
  start_stack
  wait_for_health
}

# --------------------------------------------------------------------------- #
# Diagnostics
# --------------------------------------------------------------------------- #
diagnostics_output_dir() {
  for _candidate in "$SCRIPT_DIR" "${HOME:-}" "${TMPDIR:-/tmp}"; do
    [ -n "$_candidate" ] || continue
    [ -d "$_candidate" ] || continue
    [ -w "$_candidate" ] || continue
    printf '%s' "$_candidate"
    return 0
  done
  return 1
}

redact_env_file() {
  _source=$1
  _destination=$2

  awk '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { print; next }
    /=/ {
      key = $0
      sub(/=.*/, "", key)
      clean = key
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", clean)
      upper = toupper(clean)
      if (upper ~ /PASSWORD|SECRET|TOKEN|PRIVATE|CREDENTIAL|DATABASE_URL|API_KEY/) {
        print key "=***REDACTED***"
      } else {
        print
      }
      next
    }
    { print }
  ' "$_source" > "$_destination" 2>/dev/null || true
}

redact_exact_secrets_in_tree() {
  _root=$1
  [ -d "$_root" ] || return 0
  [ -f "$ENV_FILE" ] || return 0

  _secret_file=$(mktemp "${TMPDIR:-/tmp}/afct-secrets.XXXXXX") || return 0
  chmod 600 "$_secret_file" 2>/dev/null || true
  for _key in POSTGRES_PASSWORD DATABASE_URL NEXTAUTH_SECRET ADMIN_PASSWORD; do
    _value=$(read_env_value "$_key" "$ENV_FILE")
    [ -n "$_value" ] && printf '%s\n' "$_value" >> "$_secret_file"
  done

  find "$_root" -type f 2>/dev/null | while IFS= read -r _file; do
    [ -f "$_file" ] || continue
    _tmp="${_file}.redacting.$$"
    cp "$_file" "$_tmp" 2>/dev/null || continue
    while IFS= read -r _secret; do
      [ -n "$_secret" ] || continue
      awk -v secret="$_secret" '{ gsub(secret, "***REDACTED***"); print }' "$_tmp" > "${_tmp}.next" 2>/dev/null || continue
      mv "${_tmp}.next" "$_tmp"
    done < "$_secret_file"
    mv "$_tmp" "$_file" 2>/dev/null || rm -f "$_tmp"
  done
  rm -f "$_secret_file" 2>/dev/null || true
}


collect_diagnostics() {
  _reason=${1:-manual}
  DIAG_IN_PROGRESS="true"

  _timestamp=$(date +%Y%m%d-%H%M%S 2>/dev/null || printf 'now')
  DIAG_WORK=$(mktemp -d "${TMPDIR:-/tmp}/${DIAG_PREFIX}.XXXXXX") || {
    error "could not create a temporary diagnostics directory."
    return 1
  }
  _bundle_name="${DIAG_PREFIX}-${_timestamp}-$$"
  _bundle_dir="${DIAG_WORK}/${_bundle_name}"
  _output_dir=$(diagnostics_output_dir) || {
    error "no writable directory is available for the diagnostics archive."
    return 1
  }
  mkdir -p "$_bundle_dir" || return 1

  info "collecting AFCT diagnostics..."

  {
    printf 'AFCT installer version: %s\n' "$INSTALLER_VERSION"
    printf 'Collection reason: %s\n' "$_reason"
    printf 'Collected: %s\n\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf 'unknown')"
    uname -a 2>/dev/null || true
    printf '\n'
    cat /etc/os-release 2>/dev/null || true
    sw_vers 2>/dev/null || true
  } > "$_bundle_dir/system.txt" 2>&1

  if resolve_docker_access_soft; then
    docker_cmd version > "$_bundle_dir/docker-version.txt" 2>&1 || true
    docker_cmd info > "$_bundle_dir/docker-info.txt" 2>&1 || true

    if [ -n "$COMPOSE_KIND" ] && [ -f "$COMPOSE_FILE" ]; then
      compose_project ps > "$_bundle_dir/compose-ps.txt" 2>&1 || true
      compose_project logs --no-color --tail 400 > "$_bundle_dir/compose-logs.txt" 2>&1 || true
    fi
  else
    printf 'Docker was unavailable or its daemon could not be reached without prompting.\n' \
      > "$_bundle_dir/docker-unavailable.txt"
  fi

  [ -f "$COMPOSE_FILE" ] && cp "$COMPOSE_FILE" "$_bundle_dir/docker-compose.yml" 2>/dev/null || true
  [ -f "$LOG_FILE" ] && cp "$LOG_FILE" "$_bundle_dir/install.log" 2>/dev/null || true
  [ -f "$ENV_FILE" ] && redact_env_file "$ENV_FILE" "$_bundle_dir/env.redacted.txt"
  [ -n "$PULL_OUTPUT" ] && [ -f "$PULL_OUTPUT" ] && \
    cp "$PULL_OUTPUT" "$_bundle_dir/image-pull.txt" 2>/dev/null || true
  [ -n "$DOCKER_INSTALL_OUTPUT" ] && [ -f "$DOCKER_INSTALL_OUTPUT" ] && \
    cp "$DOCKER_INSTALL_OUTPUT" "$_bundle_dir/docker-install.txt" 2>/dev/null || true

  {
    printf 'Installer version: %s\n' "$INSTALLER_VERSION"
    printf 'Files included:\n'
    find "$_bundle_dir" -type f -maxdepth 1 -print 2>/dev/null | sed 's#^.*/#  - #' || true
    printf '\nKnown configuration values were redacted by key and by exact value.\n'
  } > "$_bundle_dir/manifest.txt"

  redact_exact_secrets_in_tree "$_bundle_dir"

  _archive=""
  if command -v zip >/dev/null 2>&1; then
    _archive="${_output_dir}/${_bundle_name}.zip"
    if ! (cd "$DIAG_WORK" && zip -qr "$_archive" "$_bundle_name"); then
      _archive=""
    fi
  fi

  if [ -z "$_archive" ]; then
    _archive="${_output_dir}/${_bundle_name}.tar.gz"
    if ! tar -C "$DIAG_WORK" -czf "$_archive" "$_bundle_name"; then
      rm -rf "$DIAG_WORK" 2>/dev/null || true
      DIAG_WORK=""
      error "could not create the diagnostics archive."
      return 1
    fi
  fi

  rm -rf "$DIAG_WORK" 2>/dev/null || true
  DIAG_WORK=""

  success "Diagnostics saved to ${_archive}"
  warn "known configuration secrets were redacted, but logs and Compose files can still contain sensitive information. Review the archive before sharing it."
  DIAG_IN_PROGRESS="false"
  return 0
}

# --------------------------------------------------------------------------- #
# Installation configuration flow
# --------------------------------------------------------------------------- #
configure_new_install() {
  step "AFCT configuration"

  _default_url="https://$(hostname 2>/dev/null || printf 'localhost')"
  _requested_url=${APP_URL:-}
  if [ -z "$_requested_url" ]; then
    _requested_url=$(prompt_default "Public URL" "$_default_url")
  fi
  APP_URL_IN=$(normalize_app_url "$_requested_url") || \
    die "APP_URL must be a valid http:// or https:// origin without spaces, paths, queries, or fragments."
  is_env_value_safe "$APP_URL_IN" || die "APP_URL contains unsupported characters."
  warn_for_app_url "$APP_URL_IN"

  ADMIN_EMAIL_IN=${ADMIN_EMAIL:-}
  if [ -z "$ADMIN_EMAIL_IN" ]; then
    ADMIN_EMAIL_IN=$(prompt_required "Administrator email") || \
      die "ADMIN_EMAIL is required. Set it as an environment variable or run interactively."
  fi
  is_email "$ADMIN_EMAIL_IN" || die "the administrator email does not appear valid: ${ADMIN_EMAIL_IN}"
  is_env_value_safe "$ADMIN_EMAIL_IN" || die "ADMIN_EMAIL contains unsupported characters."

  _provided_password=$(read_password_source)
  _password_generated="false"

  if [ -n "$_provided_password" ]; then
    ADMIN_PASSWORD_IN=$_provided_password
  elif ! can_prompt; then
    if [ "$NON_INTERACTIVE" = "true" ]; then
      die "ADMIN_PASSWORD or ADMIN_PASSWORD_FILE is required in non-interactive mode."
    fi
    ADMIN_PASSWORD_IN=$(gen_admin_password) || die "could not generate a secure administrator password."
    _password_generated="true"
  else
    _choice=$(prompt_default "Set the administrator password yourself (t) or generate one (g)?" "g")
    case "$_choice" in
      g|G|generate)
        ADMIN_PASSWORD_IN=$(gen_admin_password) || die "could not generate a secure administrator password."
        _password_generated="true"
        ;;
      *)
        while :; do
          ADMIN_PASSWORD_IN=$(prompt_secret "Administrator password") || die "could not read the password."
          if ! is_strong_password "$ADMIN_PASSWORD_IN"; then
            warn "the password must be 8-72 characters and include uppercase, lowercase, a number, and a special character."
            continue
          fi
          if ! is_env_value_safe "$ADMIN_PASSWORD_IN"; then
            warn "the password cannot contain line breaks, quotes, backslashes, tabs, leading or trailing spaces, or a space before '#'."
            continue
          fi
          _confirmation=$(prompt_secret "Confirm administrator password") || die "could not read the password confirmation."
          if [ "$ADMIN_PASSWORD_IN" = "$_confirmation" ]; then
            break
          fi
          warn "the passwords did not match."
        done
        ;;
    esac
  fi

  is_strong_password "$ADMIN_PASSWORD_IN" || \
    die "the administrator password must be 8-72 characters and include uppercase, lowercase, a number, and a special character."
  is_env_value_safe "$ADMIN_PASSWORD_IN" || \
    die "the administrator password cannot contain line breaks, quotes, backslashes, tabs, leading or trailing spaces, or a space before '#'."

  POSTGRES_PASSWORD_IN=$(gen_secret) || die "could not generate a PostgreSQL password."
  NEXTAUTH_SECRET_IN=$(gen_secret) || die "could not generate an authentication secret."
  DATABASE_URL_IN="postgresql://afct_user:${POSTGRES_PASSWORD_IN}@postgres:5432/afct"
  ADMIN_PASSWORD_GENERATED=$_password_generated
}

configure_existing_install() {
  step "Reconfiguration"

  _existing_url=$(read_env_value NEXTAUTH_URL "$ENV_FILE")
  _existing_email=$(read_env_value ADMIN_EMAIL "$ENV_FILE")
  _existing_password=$(read_env_value ADMIN_PASSWORD "$ENV_FILE")

  _default_url=${_existing_url:-"https://$(hostname 2>/dev/null || printf 'localhost')"}
  _requested_url=${APP_URL:-}
  if [ -z "$_requested_url" ]; then
    _requested_url=$(prompt_default "Public URL" "$_default_url")
  fi
  APP_URL_IN=$(normalize_app_url "$_requested_url") || \
    die "APP_URL must be a valid http:// or https:// origin without spaces, paths, queries, or fragments."
  is_env_value_safe "$APP_URL_IN" || die "APP_URL contains unsupported characters."
  warn_for_app_url "$APP_URL_IN"

  ADMIN_EMAIL_IN=${ADMIN_EMAIL:-$_existing_email}
  [ -n "$ADMIN_EMAIL_IN" ] || die "ADMIN_EMAIL is missing from the existing configuration."
  is_email "$ADMIN_EMAIL_IN" || die "the administrator email does not appear valid: ${ADMIN_EMAIL_IN}"

  _provided_password=$(read_password_source)
  if [ -n "$_provided_password" ]; then
    ADMIN_PASSWORD_IN=$_provided_password
    warn "updating ADMIN_PASSWORD only changes the bootstrap setting; it does not change an already-created AFCT account password."
  else
    ADMIN_PASSWORD_IN=$_existing_password
  fi
  [ -n "$ADMIN_PASSWORD_IN" ] || die "ADMIN_PASSWORD is missing from the existing configuration."
  # The saved value only seeds the bootstrap admin on first run; the live account
  # password lives in the database. Don't block a reconfigure on it — just warn.
  is_strong_password "$ADMIN_PASSWORD_IN" || \
    warn "the saved administrator bootstrap password does not meet the current strength policy; keeping it unchanged (it only affects first-run seeding)."
  is_env_value_safe "$ADMIN_PASSWORD_IN" || die "the saved administrator password contains characters this installer cannot rewrite safely; edit ${ENV_FILE} manually."

  POSTGRES_PASSWORD_IN=$(read_env_value POSTGRES_PASSWORD "$ENV_FILE")
  DATABASE_URL_IN=$(read_env_value DATABASE_URL "$ENV_FILE")
  NEXTAUTH_SECRET_IN=$(read_env_value NEXTAUTH_SECRET "$ENV_FILE")

  require_value "$POSTGRES_PASSWORD_IN" "POSTGRES_PASSWORD is missing from ${ENV_FILE}."
  require_value "$DATABASE_URL_IN" "DATABASE_URL is missing from ${ENV_FILE}."
  require_value "$NEXTAUTH_SECRET_IN" "NEXTAUTH_SECRET is missing from ${ENV_FILE}."

  if [ -n "${POSTGRES_PASSWORD:-}${DATABASE_URL:-}${NEXTAUTH_SECRET:-}" ]; then
    warn "exported infrastructure credentials were ignored during reconfiguration to avoid breaking the existing database or invalidating sessions."
  fi

  ADMIN_PASSWORD_GENERATED="false"
}

review_configuration() {
  step "Review"
  info "Public URL:        ${APP_URL_IN}"
  info "Administrator:     ${ADMIN_EMAIL_IN}"
  info "Compose file:      ${COMPOSE_FILE}"
  info "Environment file:  ${ENV_FILE}"

  if [ "$RECONFIGURING" = "true" ]; then
    info "Database and authentication secrets will be preserved."
  fi

  if can_prompt && [ "$ASSUME_YES" != "true" ]; then
    confirm "Continue with this configuration?" "y" || die "installation cancelled."
  fi
}

do_install() {
  DIAG_ON_EXIT="false"
  acquire_lock
  preflight

  if existing_data_without_config; then
    die "existing AFCT data volumes were detected, but ${ENV_FILE} is missing or incomplete. Restore a protected configuration backup with 'sh install.sh recover' instead of generating new database credentials."
  fi

  RECONFIGURING="false"
  _existing_complete="false"
  if [ -f "$ENV_FILE" ] && env_file_complete "$ENV_FILE"; then
    _existing_complete="true"
  fi

  if [ "$_existing_complete" = "true" ] && [ "$FORCE_RECONFIGURE" != "true" ]; then
    if can_prompt; then
      existing_install_menu
      if [ "$RECONFIGURING" != "true" ]; then
        info "using the existing ${ENV_FILE}."
        step "Deploy"
        DIAG_ON_EXIT="true"
        deploy_stack
        print_completion
        DIAG_ON_EXIT="false"
        maybe_enable_updater_at_install
        return 0
      fi
    else
      info "using the existing ${ENV_FILE}. Pass --reconfigure to replace managed settings."
      step "Deploy"
      DIAG_ON_EXIT="true"
      deploy_stack
      print_completion
      DIAG_ON_EXIT="false"
      maybe_enable_updater_at_install
      return 0
    fi
  elif [ "$_existing_complete" = "true" ]; then
    RECONFIGURING="true"
  elif [ -f "$ENV_FILE" ]; then
    warn "${ENV_FILE} is incomplete and will be rebuilt after a backup is created."
  fi

  if [ "$RECONFIGURING" = "true" ]; then
    configure_existing_install
  else
    configure_new_install
  fi

  review_configuration
  backup_env_file
  write_environment_file
  success "Configuration written to ${ENV_FILE}."

  step "Deploy"
  DIAG_ON_EXIT="true"
  deploy_stack
  print_completion
  DIAG_ON_EXIT="false"
  maybe_enable_updater_at_install
}

print_completion() {
  heading "AFCT Dashboard is ready"
  info "Open:          ${APP_URL_IN:-$(read_env_value NEXTAUTH_URL "$ENV_FILE")}"
  info "Administrator: ${ADMIN_EMAIL_IN:-$(read_env_value ADMIN_EMAIL "$ENV_FILE")}"

  if [ "${ADMIN_PASSWORD_GENERATED:-false}" = "true" ]; then
    show_secret ""
    show_secret "Generated administrator password: ${ADMIN_PASSWORD_IN}"
    show_secret "Save this password now. It is intentionally not written to install.log."
  fi

  info ""
  info "Useful commands:"
  info "  sh install.sh status"
  info "  sh install.sh doctor"
  info "  sh install.sh logs"
  info "  sh install.sh update"
  info "  sh install.sh diagnostics"
  info ""
  info "A self-signed certificate may trigger a browser warning until a trusted certificate is configured."
}


capture_running_images() {
  UPDATE_IMAGE_SNAPSHOT=$(mktemp "${TMPDIR:-/tmp}/afct-images.XXXXXX") || \
    die "could not create an update rollback snapshot."
  : > "$UPDATE_IMAGE_SNAPSHOT"

  compose_project config --images 2>/dev/null | while IFS= read -r _reference; do
    [ -n "$_reference" ] || continue
    _id=$(docker_cmd image inspect -f '{{.Id}}' "$_reference" 2>/dev/null || true)
    [ -n "$_id" ] && printf '%s|%s\n' "$_reference" "$_id"
  done > "$UPDATE_IMAGE_SNAPSHOT"

  if [ -s "$UPDATE_IMAGE_SNAPSHOT" ]; then
    info "recorded the currently deployed image IDs for automatic rollback."
  else
    warn "no existing image snapshot could be recorded; automatic rollback may be unavailable."
  fi
}

rollback_update_images() {
  [ -n "${UPDATE_IMAGE_SNAPSHOT:-}" ] && [ -s "$UPDATE_IMAGE_SNAPSHOT" ] || return 1

  warn "restoring the previously deployed container images..."
  while IFS='|' read -r _reference _id; do
    [ -n "$_reference" ] && [ -n "$_id" ] || continue
    docker_cmd image tag "$_id" "$_reference" >/dev/null 2>&1 || return 1
  done < "$UPDATE_IMAGE_SNAPSHOT"

  if [ "$LOG_ENABLED" = "true" ]; then
    compose_project up -d >> "$LOG_FILE" 2>&1 || return 1
  else
    compose_project up -d || return 1
  fi

  if ( wait_for_health ); then
    success "The previous AFCT images were restored successfully."
    return 0
  fi
  return 1
}

# --------------------------------------------------------------------------- #
# Operational commands
# --------------------------------------------------------------------------- #
prepare_existing_stack() {
  [ -f "$COMPOSE_FILE" ] || die "${COMPOSE_FILE} was not found next to this script."
  [ -f "$ENV_FILE" ] || die "${ENV_FILE} was not found. Run the installer first."
  # Operational commands act on an already-installed stack: require Docker and
  # Compose to be present, but never install or prompt to install them here.
  resolve_docker_access || die "Docker Compose is not available. Install it and rerun."
}

show_status() {
  prepare_existing_stack
  compose_project ps

  _app_id=$(compose_project ps -q "$APP_SERVICE" 2>/dev/null || true)
  if [ -z "$_app_id" ]; then
    warn "the ${APP_SERVICE} container is not running."
    return 1
  fi

  _state=$(docker_cmd inspect \
    -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    "$_app_id" 2>/dev/null || printf 'unknown|unknown')
  info "application state: ${_state%%|*}"
  info "application health: ${_state#*|}"
}

show_logs() {
  prepare_existing_stack
  info "following ${APP_SERVICE} logs; press Ctrl+C to stop..."
  compose_project logs -f --tail 200 "$APP_SERVICE"
}

# Download a URL to a file with curl or wget (whichever is present). Non-zero on
# failure. Mirrors the Docker-installer download above.
fetch_url() {
  _url=$1
  _dest=$2
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$_url" -o "$_dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$_dest" "$_url"
  else
    die "curl or wget is required to download files."
  fi
}

# Refresh the deploy bundle (this installer, the compose file, and the env template)
# from the public repo. It never touches .env.production, data volumes, or running
# containers — it only updates the files on disk. Run it before `update` when a
# release changed the compose file or the updater (the Updates tab flags those).
do_self_update() {
  info "refreshing the AFCT deploy files from ${INSTALLER_BASE_URL} ..."

  # Stage every download first so a partial or failed fetch never clobbers a working
  # installer. Temp files live in SCRIPT_DIR so the final swap is an atomic rename on
  # the same filesystem (safe even though this script is the file being replaced).
  _t_installer="${SCRIPT_DIR}/.install.sh.new.$$"
  _t_compose="${SCRIPT_DIR}/.${COMPOSE_FILE}.new.$$"
  _t_example="${SCRIPT_DIR}/.${ENV_EXAMPLE}.new.$$"
  _cleanup='rm -f "$_t_installer" "$_t_compose" "$_t_example"'

  if ! fetch_url "${INSTALLER_BASE_URL}/install.sh" "$_t_installer" \
    || ! fetch_url "${INSTALLER_BASE_URL}/${COMPOSE_FILE}" "$_t_compose" \
    || ! fetch_url "${INSTALLER_BASE_URL}/${ENV_EXAMPLE}" "$_t_example"; then
    eval "$_cleanup"
    die "could not download the deploy files. Check network access to the repository."
  fi

  # Refuse to install a truncated or corrupt installer.
  if [ ! -s "$_t_installer" ] || ! sh -n "$_t_installer" 2>/dev/null; then
    eval "$_cleanup"
    die "the downloaded installer is invalid; keeping the current one."
  fi

  _changed=""
  # file | temp | back-up-the-old-copy?
  for _row in "install.sh|$_t_installer|yes" "${COMPOSE_FILE}|$_t_compose|yes" "${ENV_EXAMPLE}|$_t_example|no"; do
    _name=${_row%%|*}
    _rest=${_row#*|}
    _tmp=${_rest%%|*}
    _bak=${_rest##*|}
    _target="${SCRIPT_DIR}/${_name}"

    if [ -f "$_target" ] && cmp -s "$_tmp" "$_target"; then
      rm -f "$_tmp"
      continue
    fi
    if [ -f "$_target" ] && [ "$_bak" = "yes" ]; then
      _stamp=$(date +%Y%m%d-%H%M%S 2>/dev/null || printf 'previous')
      cp "$_target" "${_target}.backup.${_stamp}" 2>/dev/null \
        && info "saved the previous ${_name} as ${_name}.backup.${_stamp}."
    fi
    mv "$_tmp" "$_target" || { eval "$_cleanup"; die "could not replace ${_name}."; }
    _changed="${_changed} ${_name}"
  done
  chmod +x "${SCRIPT_DIR}/install.sh" 2>/dev/null || true

  if [ -z "$_changed" ]; then
    success "The deploy files are already up to date."
    return 0
  fi
  success "Updated:${_changed}"
  info "Your .env.production and data volumes were not touched."
  info "Apply any new image or compose changes with: sh install.sh update"
}

do_update() {
  acquire_lock
  prepare_existing_stack
  DIAG_ON_EXIT="true"
  info "updating AFCT to the latest published images..."

  validate_compose
  capture_running_images
  pull_images

  if ( start_stack; wait_for_health ); then
    success "AFCT update completed."
    DIAG_ON_EXIT="false"
    return 0
  fi

  error "the newly downloaded AFCT version did not pass its health check."
  collect_diagnostics "failed-update-before-rollback" || true
  # A bundle was just created above; don't let the exit trap collect a second one.
  DIAG_ON_EXIT="false"

  if rollback_update_images; then
    warn "the update failed, but AFCT was returned to the previously deployed images."
    DIAG_ON_EXIT="false"
    return 1
  fi

  die "the update failed and automatic rollback was unsuccessful. Review the diagnostics archive."
}

do_restart() {
  acquire_lock
  prepare_existing_stack
  DIAG_ON_EXIT="true"
  info "recreating the AFCT stack..."
  restart_stack
  success "AFCT restart completed."
  DIAG_ON_EXIT="false"
}

# Set the flag and pull+start the updater. Returns non-zero on failure so the
# caller decides whether that is fatal (a standalone enable) or a warning (during
# install, where the rest of the stack is already up).
start_updater() {
  set_env_flag AFCT_UPDATER_ENABLED true
  info "downloading the updater image..."
  # Match pull_images: on a terminal, let Docker render its own download progress;
  # otherwise keep the output in the log.
  if [ -t 1 ] || [ "$LOG_ENABLED" != "true" ]; then
    compose_project pull "$UPDATER_SERVICE" || return 1
  else
    compose_project pull "$UPDATER_SERVICE" >> "$LOG_FILE" 2>&1 || return 1
  fi
  info "starting the updater..."
  if [ "$LOG_ENABLED" = "true" ]; then
    compose_project up -d "$UPDATER_SERVICE" >> "$LOG_FILE" 2>&1 || return 1
  else
    compose_project up -d "$UPDATER_SERVICE" || return 1
  fi
  return 0
}

# Turn on the privileged updater sidecar (in-app upgrades/downgrades). Off by
# default because it holds the Docker socket. Once enabled, the AFCT_UPDATER_ENABLED
# flag makes update/restart/status/diagnostics include it automatically.
do_enable_updater() {
  acquire_lock
  prepare_existing_stack

  heading "Enabling the in-app updater"
  warn "the updater container holds the Docker socket, which is root-equivalent on this host. Enable it only if you want to run upgrades and downgrades from Admin -> System Settings."
  if ! confirm "Enable the in-app updater now?" "y"; then
    die "left the updater disabled."
  fi

  DIAG_ON_EXIT="true"
  start_updater || die "could not pull or start the updater image. If this repository's afct-updater package is private, make it public or run 'docker login ghcr.io'. See ${LOG_FILE}."
  DIAG_ON_EXIT="false"
  success "in-app updater enabled. Manage versions in Admin -> System Settings -> Updates."
}

# Offer to enable the updater at the end of a guided install (or honor
# --with-updater). Non-fatal: the base stack is already healthy, so a failure here
# only warns and leaves the updater disabled.
maybe_enable_updater_at_install() {
  [ "$(read_env_value AFCT_UPDATER_ENABLED "$ENV_FILE" 2>/dev/null)" = "true" ] && return 0

  if [ "$WITH_UPDATER" != "true" ]; then
    can_prompt || return 0
    heading "Optional: in-app updater"
    info "The updater sidecar lets admins upgrade and downgrade AFCT from"
    info "System Settings. It holds the Docker socket (root-equivalent on this host),"
    info "so it is off unless you turn it on."
    confirm "Enable the in-app updater now?" "n" || {
      info "skipped. Enable it later with: sh install.sh enable-updater"
      return 0
    }
  fi

  if start_updater; then
    success "in-app updater enabled."
  else
    set_env_flag AFCT_UPDATER_ENABLED false
    warn "could not start the updater (the afct-updater image may be private or unpublished). The rest of AFCT is running; enable it later with: sh install.sh enable-updater"
  fi
}

# Stop and remove the updater sidecar, and clear the flag so it stays off.
do_disable_updater() {
  acquire_lock
  prepare_existing_stack
  info "disabling the in-app updater..."
  # The profile must be active for compose to see the service, so remove it before
  # clearing the flag.
  compose_project rm -sf "$UPDATER_SERVICE" >/dev/null 2>&1 || true
  set_env_flag AFCT_UPDATER_ENABLED false
  success "in-app updater disabled and its container removed."
}

do_stop() {
  acquire_lock
  prepare_existing_stack
  info "stopping the AFCT stack..."
  compose_project stop
  success "AFCT stopped. Persistent data volumes were not deleted."
}


doctor_check() {
  _label=$1
  shift
  if "$@"; then
    success "$_label"
    DOCTOR_OK=$((DOCTOR_OK + 1))
  else
    warn "$_label"
    DOCTOR_WARN=$((DOCTOR_WARN + 1))
  fi
}

doctor_file_exists() { [ -f "$1" ]; }
doctor_env_complete() { env_file_complete "$ENV_FILE"; }
doctor_compose_valid() { compose_project config >/dev/null 2>&1; }
doctor_disk() {
  command -v df >/dev/null 2>&1 || return 0
  _available=$(df -Pk . 2>/dev/null | awk 'NR == 2 { print $4 }')
  case "$_available" in ''|*[!0-9]*) return 0 ;; esac
  [ "$_available" -ge 5242880 ]
}
doctor_web() { http_health_responding; }
doctor_app_healthy() {
  _id=$(compose_project ps -q "$APP_SERVICE" 2>/dev/null || true)
  [ -n "$_id" ] || return 1
  [ "$(docker_cmd inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$_id" 2>/dev/null || true)" = "healthy" ]
}

do_doctor() {
  heading "AFCT system check"
  DOCTOR_OK=0
  DOCTOR_WARN=0

  doctor_check "Compose file exists" doctor_file_exists "$COMPOSE_FILE"
  doctor_check "Environment file exists" doctor_file_exists "$ENV_FILE"
  doctor_check "Environment configuration is complete" doctor_env_complete
  check_sensitive_permissions "$ENV_FILE" && success "Environment file permissions are private" && DOCTOR_OK=$((DOCTOR_OK + 1)) || DOCTOR_WARN=$((DOCTOR_WARN + 1))
  doctor_check "At least 5 GB of disk space is available" doctor_disk
  check_clock_sync && success "System clock synchronization is enabled" && DOCTOR_OK=$((DOCTOR_OK + 1)) || DOCTOR_WARN=$((DOCTOR_WARN + 1))

  if resolve_docker_access_soft && [ -n "$COMPOSE_KIND" ]; then
    success "Docker daemon is reachable"
    DOCTOR_OK=$((DOCTOR_OK + 1))
    doctor_check "Docker Compose configuration is valid" doctor_compose_valid
    doctor_check "Application container is healthy" doctor_app_healthy
    if command -v curl >/dev/null 2>&1; then
      doctor_check "Local AFCT health endpoint responds" doctor_web
    else
      warn "curl is unavailable; the local HTTP health check was skipped."
      DOCTOR_WARN=$((DOCTOR_WARN + 1))
    fi
    show_deployed_versions
  else
    warn "Docker or Docker Compose is unavailable."
    DOCTOR_WARN=$((DOCTOR_WARN + 1))
  fi

  info ""
  info "Doctor result: ${DOCTOR_OK} checks passed; ${DOCTOR_WARN} warnings or failures."
  [ "$DOCTOR_WARN" -eq 0 ]
}

do_recover() {
  acquire_lock
  [ ! -f "$ENV_FILE" ] || die "${ENV_FILE} already exists. Recovery is intended for a missing configuration."
  set -- "${ENV_FILE}.backup."*
  [ -e "$1" ] || die "no protected ${ENV_FILE}.backup.* files were found."
  _latest=$(ls -1t "${ENV_FILE}.backup."* 2>/dev/null | head -n 1)
  [ -n "$_latest" ] || die "no recoverable environment backup was found."
  info "newest configuration backup: ${_latest}"
  if can_prompt && [ "$ASSUME_YES" != "true" ]; then
    confirm "Restore this configuration backup?" "y" || die "recovery cancelled."
  fi
  cp "$_latest" "$ENV_FILE" || die "could not restore ${ENV_FILE}."
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  env_file_complete "$ENV_FILE" || die "the restored environment file is incomplete."
  success "Configuration restored from ${_latest}."
  info "Run: sh install.sh doctor"
  info "Then run: sh install.sh restart"
}

existing_install_menu() {
  heading "Existing AFCT installation detected"
  info "1. Start or repair the installation"
  info "2. Update to the latest published images"
  info "3. Reconfigure the public URL or bootstrap settings"
  info "4. Run system checks"
  info "5. Create a diagnostics archive"
  info "6. Exit"
  _choice=$(prompt_default "Choose an action" "1")
  case "$_choice" in
    1|"") return 0 ;;
    2) do_update; exit $? ;;
    3) RECONFIGURING="true"; return 0 ;;
    4) do_doctor; exit $? ;;
    5) collect_diagnostics "manual"; exit $? ;;
    6) info "no changes were made."; exit 0 ;;
    *) die "unknown menu choice: ${_choice}" ;;
  esac
}

# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
case "$MODE" in
  help)
    usage
    ;;
  version)
    show_deployed_versions
    ;;
  doctor)
    do_doctor
    ;;
  recover)
    init_log
    do_recover
    ;;
  diagnostics)
    LOG_ENABLED="false"
    collect_diagnostics "manual"
    ;;
  status)
    show_status
    ;;
  logs)
    show_logs
    ;;
  update)
    init_log
    do_update
    ;;
  self-update)
    do_self_update
    ;;
  restart)
    init_log
    do_restart
    ;;
  stop)
    init_log
    do_stop
    ;;
  enable-updater)
    init_log
    do_enable_updater
    ;;
  disable-updater)
    init_log
    do_disable_updater
    ;;
  install)
    init_log
    do_install
    ;;
  *)
    printf '[afct] ERROR: unsupported mode: %s\n' "$MODE" >&2
    exit 2
    ;;
esac
