#!/bin/sh
# AFCT Dashboard: Linux / macOS installer.
#
# Usage:
#   sh install.sh                  Run the guided install (default).
#   sh install.sh diagnostics      Collect a support zip (redacted) and exit.
#   sh install.sh --help
#
# Flags:
#   -y, --yes          Auto-answer confirmation prompts with their default. Value
#                      prompts (e.g. a missing admin email) are STILL asked, so this
#                      needs a terminal for anything not supplied via env vars.
#   --non-interactive  Never prompt: use env vars and defaults, and fail immediately
#                      if a required value (e.g. ADMIN_EMAIL/ADMIN_PASSWORD) is
#                      missing. Use this for automated / unattended installs.
#
# Unattended install: supply the prompted values as env vars, e.g.
#   ADMIN_EMAIL=admin@x.edu ADMIN_PASSWORD=... APP_URL=https://afct.x.edu \
#     sh install.sh --non-interactive
#
# The script is self-contained: on Linux it installs Docker for you if it's
# missing (via the official get.docker.com script); otherwise it just needs
# Docker with the Compose plugin, plus this folder's docker-compose.yml and
# .env.production.example.

set -eu

# Restrictive perms for everything we create: the install log and .env.production
# both hold secrets. Set before the first file is written.
umask 077

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env.production"
ENV_EXAMPLE=".env.production.example"
LOG_FILE="install.log"
DIAG_PREFIX="afct-diagnostics"

ASSUME_YES="false"        # --yes: auto-answer confirmation prompts with their default
NON_INTERACTIVE="false"   # --non-interactive: never prompt; fail on missing required input
MODE="install"
DOCKER_SUDO=""                              # set to "sudo" at preflight if the daemon needs it
OS=$(uname -s 2>/dev/null || echo unknown)  # Linux / Darwin

usage() {
  cat <<'EOF'
AFCT Dashboard installer

Usage:
  sh install.sh                Run the guided install (default).
  sh install.sh status         Show the stack's container + health status.
  sh install.sh logs           Follow the application logs (Ctrl+C to stop).
  sh install.sh update         Pull the latest images and restart the stack.
  sh install.sh diagnostics    Collect a redacted support bundle and exit.
  sh install.sh --help

Options:
  -y, --yes           Auto-answer confirmation prompts with their default. Value
                      prompts (e.g. a missing admin email) are still asked, so this
                      needs a terminal for anything not supplied via env vars.
  --non-interactive   Never prompt: use env vars and defaults, and fail immediately
                      if a required value (e.g. ADMIN_EMAIL/ADMIN_PASSWORD) is missing.
  -h, --help          Show this help.

Unattended install: supply the prompted values as env vars, e.g.
  ADMIN_EMAIL=admin@x.edu ADMIN_PASSWORD=... APP_URL=https://afct.x.edu \
    sh install.sh --non-interactive
EOF
}

# Reject unknown options rather than silently starting an install (so a typo like
# `--diagnositcs` fails loudly instead of running the wrong thing).
while [ "$#" -gt 0 ]; do
  case "$1" in
    diagnostics|--diagnostics) MODE="diagnostics" ;;
    status|--status) MODE="status" ;;
    logs|--logs) MODE="logs" ;;
    update|--update) MODE="update" ;;
    -y|--yes) ASSUME_YES="true" ;;
    --non-interactive|--noninteractive) NON_INTERACTIVE="true" ;;
    -h|--help) MODE="help" ;;
    *)
      printf '[afct] ERROR: unknown option: %s\n' "$1" >&2
      printf '[afct] Run: sh install.sh --help\n' >&2
      exit 2
      ;;
  esac
  shift
done

# --------------------------------------------------------------------------- #
# Output helpers (everything is teed to the install log)
# --------------------------------------------------------------------------- #
# NOTE: the log is APPENDED to, never truncated — truncating here (before the mode
# is dispatched) would wipe the very log that `diagnostics` collects.
log()  { printf '[afct] %s\n' "$*" | tee -a "$LOG_FILE"; }
warn() { printf '[afct] WARNING: %s\n' "$*" | tee -a "$LOG_FILE" >&2; }
errln(){ printf '[afct] ERROR: %s\n' "$*" | tee -a "$LOG_FILE" >&2; }
ask()  { printf '%s' "$1" >&2; }

# Start a fresh run in the appended log (install mode only; diagnostics/help leave
# the existing log untouched so it can be collected/inspected intact).
init_log() {
  touch "$LOG_FILE" 2>/dev/null || true
  chmod 600 "$LOG_FILE" 2>/dev/null || true
  {
    printf '\n============================================================\n'
    printf 'AFCT installer run: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo unknown)"
    printf 'Mode: %s\n' "$MODE"
  } >> "$LOG_FILE" 2>/dev/null || true
}

# Print a secret to the user's terminal ONLY — never through log(), which writes to
# install.log (and that file is copied into the "redacted" diagnostics bundle).
show_secret() {
  # Show the secret on the controlling terminal when there is one (so it's visible
  # even if stdout is redirected), else on stderr. Never through log()/install.log.
  # Uses only regular builtins: a redirect error on ':' (a special builtin) would
  # exit a non-interactive sh outright — which aborted the install after the stack
  # was already up. Also never fatal under `set -e`.
  if [ -c /dev/tty ] && printf '%s\n' "$*" > /dev/tty 2>/dev/null; then
    return 0
  fi
  printf '%s\n' "$*" >&2 || true
  return 0
}

# --------------------------------------------------------------------------- #
# Compose wrapper (support both `docker compose` and legacy `docker-compose`)
# --------------------------------------------------------------------------- #
compose() {
  if $DOCKER_SUDO docker compose version >/dev/null 2>&1; then
    $DOCKER_SUDO docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    $DOCKER_SUDO docker-compose "$@"
  else
    return 127
  fi
}

# True only if the env file has non-empty values for the settings the stack cannot
# start without. Guards against silently keeping an empty or truncated
# .env.production (e.g. from an interrupted run), which otherwise surfaces as a
# cryptic "Database is uninitialized and superuser password is not specified".
env_file_complete() {
  _envf="$1"
  [ -s "$_envf" ] || return 1
  for _k in POSTGRES_PASSWORD DATABASE_URL NEXTAUTH_SECRET; do
    grep -qE "^${_k}=.+" "$_envf" 2>/dev/null || return 1
  done
  return 0
}

# Echo the value of KEY from an env file (empty if absent). Values we write are
# unquoted, so this takes everything after the first '='. Used to preserve infra
# secrets across a reconfigure.
read_env_value() { # read_env_value KEY FILE
  [ -f "$2" ] || return 0
  awk -v k="$1" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' "$2" 2>/dev/null || true
}

# --------------------------------------------------------------------------- #
# Diagnostics: a redacted support bundle the user can send to the maintainer.
# Secret VALUES are masked; only keys are shown.
# --------------------------------------------------------------------------- #
collect_diagnostics() {
  ts=$(date +%Y%m%d-%H%M%S 2>/dev/null || echo now)
  work="${DIAG_PREFIX}-${ts}"
  rm -rf "$work"
  mkdir -p "$work"

  log "collecting diagnostics into ${work}/ ..."

  # Host + Docker environment
  { uname -a; echo; cat /etc/os-release 2>/dev/null; } > "$work/system.txt" 2>&1 || true
  $DOCKER_SUDO docker version > "$work/docker-version.txt" 2>&1 || true
  $DOCKER_SUDO docker info    > "$work/docker-info.txt"    2>&1 || true

  # Compose state + per-service logs (tail only)
  compose -f "$COMPOSE_FILE" ps    > "$work/compose-ps.txt"   2>&1 || true
  compose -f "$COMPOSE_FILE" logs --no-color --tail 400 \
                                   > "$work/compose-logs.txt" 2>&1 || true

  # The compose file and the install log
  cp "$COMPOSE_FILE" "$work/docker-compose.yml" 2>/dev/null || true
  cp "$LOG_FILE"     "$work/install.log"        2>/dev/null || true

  # Redacted env: keep keys, mask any value whose key looks secret.
  if [ -f "$ENV_FILE" ]; then
    awk '
      /^[[:space:]]*#/ || /^[[:space:]]*$/ { print; next }
      /=/ {
        key = $0; sub(/=.*/, "", key)
        up = toupper(key)
        if (up ~ /PASSWORD|SECRET|KEY|TOKEN|DATABASE_URL/) print key "=***REDACTED***"
        else print
        next
      }
      { print }
    ' "$ENV_FILE" > "$work/env.redacted.txt" 2>/dev/null || true
  fi

  # Zip it (fall back to tar.gz when zip is unavailable).
  if command -v zip >/dev/null 2>&1; then
    zip -qr "${work}.zip" "$work" && out="${work}.zip"
  else
    tar czf "${work}.tar.gz" "$work" && out="${work}.tar.gz"
  fi
  rm -rf "$work"

  log ""
  log "Diagnostics saved to: ${SCRIPT_DIR}/${out}"
  log "Known configuration secrets were redacted, but container logs, the compose file,"
  log "and application errors can still contain sensitive data — review the archive"
  log "before sharing it."
}

# On any unexpected failure during install, auto-collect diagnostics.
DIAG_ON_EXIT="false"
on_exit() {
  code=$?
  if [ "$code" -ne 0 ] && [ "$DIAG_ON_EXIT" = "true" ]; then
    errln "install failed (exit ${code}); collecting a support bundle..."
    collect_diagnostics || true
  fi
  return 0
}
trap on_exit EXIT

die() { errln "$*"; exit 1; }

# --------------------------------------------------------------------------- #
# Install Docker automatically when it's missing.
#
# Linux: use Docker's official convenience script (https://get.docker.com),
# which covers the common distros and also installs the Compose plugin. macOS
# can't be scripted this way, so we point the user at Docker Desktop.
# --------------------------------------------------------------------------- #
maybe_install_docker() {
  command -v docker >/dev/null 2>&1 && return 0

  if [ "$OS" != "Linux" ]; then
    errln "Docker isn't installed."
    errln "On macOS, install Docker Desktop and re-run:"
    errln "  https://www.docker.com/products/docker-desktop/"
    die "missing Docker"
  fi

  log "Docker isn't installed. AFCT needs Docker Engine and the Compose plugin."
  log "  1) Recommended for a production server: install via Docker's official,"
  log "     distro-specific instructions: https://docs.docker.com/engine/install/"
  log "  2) Or let this installer run Docker's convenience script (get.docker.com),"
  log "     which adds Docker's official repo and installs the latest stable Engine +"
  log "     Compose. Docker documents that script as aimed at dev/eval, and it may do a"
  log "     major-version upgrade on a machine that already has Docker."

  # Don't silently run a network install script in a hands-off run: --non-interactive
  # requires Docker to be installed already (option 1).
  if [ "$NON_INTERACTIVE" = "true" ]; then
    die "Docker is not installed. Install it (https://docs.docker.com/engine/install/) and re-run, or run interactively to use the convenience script."
  fi
  if [ "$ASSUME_YES" != "true" ]; then
    ans=$(prompt_default "Install Docker now via the get.docker.com convenience script?" "y")
    case "$ans" in
      y|Y|yes|Yes) : ;;
      *) die "Docker is required. Install it (https://docs.docker.com/engine/install/) and re-run." ;;
    esac
  fi

  # Installing Docker needs root; use sudo when we aren't already root.
  ins_sudo=""
  if [ "$(id -u)" != "0" ]; then
    if command -v sudo >/dev/null 2>&1; then
      ins_sudo="sudo"
    else
      die "installing Docker needs root. Re-run as root (or install sudo) and try again."
    fi
  fi

  # Download the script to a temp file and run it from there, rather than piping the
  # network straight into a root shell — so a truncated download can't half-run and
  # the pinned commit can be recorded for the log.
  get_script=$(mktemp 2>/dev/null) || die "could not create a temp file for the Docker install script."
  log "downloading the Docker install script (get.docker.com)..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com -o "$get_script" \
      || { rm -f "$get_script"; die "failed to download the Docker install script."; }
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$get_script" https://get.docker.com \
      || { rm -f "$get_script"; die "failed to download the Docker install script."; }
  else
    rm -f "$get_script"
    die "need curl or wget to download the Docker installer. Install one and re-run."
  fi
  script_commit=$(sed -n 's/^SCRIPT_COMMIT_SHA=[\"'\'']\{0,1\}\([0-9a-f]\{7,\}\).*/\1/p' "$get_script" 2>/dev/null | head -n 1)
  [ -n "$script_commit" ] && log "Docker install script commit: ${script_commit}"
  log "installing Docker (this can take a few minutes)..."
  $ins_sudo sh "$get_script" 2>&1 | tee -a "$LOG_FILE"
  rm -f "$get_script"

  # The pipe's success is tee's, not the installer's, so verify explicitly.
  command -v docker >/dev/null 2>&1 || die "Docker installation did not complete; see ${LOG_FILE}."

  # Start the daemon now and on boot.
  if command -v systemctl >/dev/null 2>&1; then
    $ins_sudo systemctl enable --now docker >/dev/null 2>&1 \
      || warn "couldn't start Docker via systemctl; start it manually if the next step fails."
  fi

  # Let the invoking user run Docker without sudo after their next login. For THIS
  # run the group isn't active yet, so preflight falls back to sudo below.
  if [ "$(id -u)" != "0" ]; then
    warn "membership in the 'docker' group grants root-equivalent control of this host (a group member can start privileged containers). Adding $(id -un) to it."
    $ins_sudo usermod -aG docker "$(id -un)" 2>/dev/null \
      && log "added $(id -un) to the 'docker' group (effective after your next login)." || true
  fi

  log "Docker installed."
}

# --------------------------------------------------------------------------- #
# Install the Docker Compose plugin if it's missing (e.g. a pre-existing Docker
# that didn't include it). A fresh get.docker.com install already bundles it.
# Package names differ by distro; the legacy standalone `docker-compose` counts.
# --------------------------------------------------------------------------- #
ensure_compose_plugin() {
  # Prefer the Compose v2 plugin ('docker compose'). Check it directly rather than via
  # compose(), which would silently accept the legacy standalone and hide the choice.
  if $DOCKER_SUDO docker compose version >/dev/null 2>&1; then
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    warn "only the legacy standalone 'docker-compose' (v1) is available. Docker considers it end-of-life; install the Compose plugin ('docker compose') when you can."
    return 0
  fi

  [ "$OS" = "Linux" ] || die "the Docker Compose plugin is required. Install it and re-run."

  log "the Docker Compose plugin isn't installed."
  if [ "$ASSUME_YES" != "true" ]; then
    ans=$(prompt_default "Install the Docker Compose plugin now?" "y")
    case "$ans" in
      y|Y|yes|Yes) : ;;
      *) die "the Compose plugin is required. Install it and re-run." ;;
    esac
  fi

  pm_sudo=""
  if [ "$(id -u)" != "0" ]; then
    if command -v sudo >/dev/null 2>&1; then pm_sudo="sudo"; else
      die "installing the Compose plugin needs root. Re-run as root (or install sudo)."
    fi
  fi

  log "installing the Docker Compose plugin..."
  if command -v apt-get >/dev/null 2>&1; then
    $pm_sudo apt-get update -y >/dev/null 2>&1 || true
    $pm_sudo apt-get install -y docker-compose-plugin 2>&1 | tee -a "$LOG_FILE"
  elif command -v dnf >/dev/null 2>&1; then
    $pm_sudo dnf install -y docker-compose-plugin 2>&1 | tee -a "$LOG_FILE"
  elif command -v yum >/dev/null 2>&1; then
    $pm_sudo yum install -y docker-compose-plugin 2>&1 | tee -a "$LOG_FILE"
  elif command -v apk >/dev/null 2>&1; then
    $pm_sudo apk add --no-cache docker-cli-compose 2>&1 | tee -a "$LOG_FILE"
  else
    die "couldn't find a package manager to install the Compose plugin. Install 'docker compose' and re-run."
  fi

  compose version >/dev/null 2>&1 || die "Compose plugin install did not complete; see ${LOG_FILE}."
  log "Docker Compose plugin installed."
}

# --------------------------------------------------------------------------- #
# Preflight
# --------------------------------------------------------------------------- #
preflight() {
  log "checking prerequisites..."

  # Install Docker automatically on Linux if it's missing.
  maybe_install_docker

  # Decide whether we need sudo to reach the daemon. Right after a fresh install
  # the current shell isn't in the 'docker' group yet, so fall back to sudo.
  if docker info >/dev/null 2>&1; then
    DOCKER_SUDO=""
  elif [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    DOCKER_SUDO="sudo"
    log "talking to the Docker daemon with sudo for this run."
  else
    die "Docker is installed but the daemon isn't reachable. Start Docker and re-run."
  fi

  # Install the Compose plugin if a pre-existing Docker didn't include it.
  ensure_compose_plugin

  # Best-effort port check (warn only; the user may intend to change ports).
  for port in 80 443; do
    if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":${port} "; then
      warn "port ${port} looks busy; the web front may fail to bind it."
    fi
  done

  # Best-effort disk check: the container images total a few GB.
  if command -v df >/dev/null 2>&1; then
    avail_kb=$(df -Pk . 2>/dev/null | awk 'NR==2 {print $4}')
    case "$avail_kb" in
      ''|*[!0-9]*) : ;;
      *) [ "$avail_kb" -lt 5242880 ] && warn "less than ~5 GB free here; the images need a few GB." || true ;;
    esac
  fi

  log "prerequisites OK."
}

# Make sure the Docker daemon starts on boot, so the stack's `restart:
# unless-stopped` policy actually brings everything back after a server reboot.
# Linux/systemd only; best-effort and never fatal. (On macOS/Windows this is
# governed by Docker Desktop's "start at login" setting instead.)
ensure_docker_boot() {
  command -v systemctl >/dev/null 2>&1 || return 0
  systemctl list-unit-files 2>/dev/null | grep -q '^docker\.service' || return 0

  if systemctl is-enabled docker >/dev/null 2>&1; then
    log "Docker is already set to start on boot."
    return 0
  fi

  log "enabling the Docker service to start on boot..."
  if [ "$(id -u)" = "0" ]; then
    systemctl enable docker >/dev/null 2>&1 \
      && log "Docker enabled at boot." \
      || warn "couldn't enable Docker at boot; run: systemctl enable docker"
  elif command -v sudo >/dev/null 2>&1; then
    sudo systemctl enable docker >/dev/null 2>&1 \
      && log "Docker enabled at boot." \
      || warn "couldn't enable Docker at boot; run: sudo systemctl enable docker"
  else
    warn "to survive a reboot, run: sudo systemctl enable docker"
  fi
}

# --------------------------------------------------------------------------- #
# Secret generation
# --------------------------------------------------------------------------- #
gen_secret() {
  # url-safe-ish token of ~40 chars. Prefer openssl; fall back to the kernel
  # CSPRNG so the installer never hard-depends on openssl being present.
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-40
  else
    head -c 48 /dev/urandom | base64 | tr -d '\n=+/' | cut -c1-40
  fi
}

# Password policy, mirroring src/lib/password-policy.ts and the production seed:
# 8-72 characters with an upper, a lower, a digit, and a special (non-alphanumeric)
# character. The app rejects a weak admin password at first-run seeding, so the
# installer enforces the same rule up front.
is_strong_password() {
  pw=$1
  [ "${#pw}" -ge 8 ] && [ "${#pw}" -le 72 ]  || return 1
  printf '%s' "$pw" | grep -q '[A-Z]'        || return 1
  printf '%s' "$pw" | grep -q '[a-z]'        || return 1
  printf '%s' "$pw" | grep -q '[0-9]'        || return 1
  printf '%s' "$pw" | grep -q '[^A-Za-z0-9]' || return 1
  return 0
}

# Generate an admin password that satisfies is_strong_password: a high-entropy
# alphanumeric core (gen_secret strips punctuation) plus one char from each
# required class. The bootstrapped admin must change it at first login, so the
# fixed policy suffix on a random core is harmless.
gen_admin_password() {
  printf '%sAa1_' "$(gen_secret)"
}

# Warn (never block) if the public URL will cause auth problems: a non-https URL
# or a bare IP produces NEXTAUTH_URL mismatches and silent login redirect loops.
validate_app_url() {
  case "$1" in
    https://*) ;;
    *) warn "the public URL should start with https:// (got '$1'); http or a bare IP causes login redirect loops."; return ;;
  esac
  host=${1#https://}; host=${host%%/*}; host=${host%%:*}
  if printf '%s' "$host" | grep -Eq '^[0-9]+(\.[0-9]+){3}$'; then
    warn "the public URL uses a bare IP ('$host'); a real hostname with a matching TLS certificate is recommended."
  fi
}

# Loose email sanity check (something@something.tld). Warn-only.
looks_like_email() {
  case "$1" in ?*@?*.?*) return 0 ;; *) return 1 ;; esac
}

# --------------------------------------------------------------------------- #
# Prompt helpers
# --------------------------------------------------------------------------- #
# True only when we may block for human input: interactive mode (not
# --non-interactive) AND a real terminal on stdin. Everything that could otherwise
# spin forever on EOF is gated on this.
can_prompt() { [ "$NON_INTERACTIVE" != "true" ] && [ -t 0 ]; }

prompt_default() { # prompt_default "Question" "default" -> echoes answer
  q=$1; d=$2
  # A defaulted question always has a safe answer: --yes auto-answers with it, and
  # when we can't prompt (no terminal / --non-interactive) we fall back to it too.
  if [ "$ASSUME_YES" = "true" ] || ! can_prompt; then printf '%s' "$d"; return; fi
  ask "$q [$d]: "
  IFS= read -r ans || ans=""
  [ -n "$ans" ] && printf '%s' "$ans" || printf '%s' "$d"
}

prompt_required() { # prompt_required "Question" -> echoes non-empty answer
  q=$1
  # No default exists here. Required values must be supplied via env when we can't
  # prompt; callers validate that up front (require_or_die), so reaching this without
  # a terminal is a bug — bail instead of looping forever on EOF. --yes does NOT skip
  # this: it only auto-answers confirmations, not missing required values.
  can_prompt || { warn "internal: cannot prompt for '$q' (no terminal)."; return 1; }
  while :; do
    ask "$q: "
    if ! IFS= read -r ans; then
      warn "no input (end of file) while reading '$q'."
      return 1
    fi
    [ -n "$ans" ] && { printf '%s' "$ans"; return 0; }
    warn "a value is required."
  done
}

prompt_secret() { # prompt_secret "Question" -> echoes typed value (no echo to screen)
  q=$1
  can_prompt || { warn "internal: cannot prompt for '$q' (no terminal)."; return 1; }
  ask "$q: "
  # Turn off echo while typing, but make sure it's restored even if the user hits
  # Ctrl+C mid-entry, so the terminal isn't left silently swallowing input.
  trap 'stty echo 2>/dev/null || true; printf "\n" >&2; exit 130' INT TERM HUP
  stty -echo 2>/dev/null || true
  IFS= read -r ans || ans=""
  stty echo 2>/dev/null || true
  trap - INT TERM HUP
  printf '\n' >&2
  printf '%s' "$ans"
}

# Fail with a clear, actionable message when a required value is missing and we
# can't ask for it. Called in the MAIN shell (not a $(...) subshell) so die exits.
require_or_die() { # require_or_die VALUE "NAME" "hint"
  [ -n "$1" ] && return 0
  die "$2 is required but was not provided. $3"
}

# --------------------------------------------------------------------------- #
# Install
# --------------------------------------------------------------------------- #
do_install() {
  DIAG_ON_EXIT="true"
  [ -f "$COMPOSE_FILE" ] || die "docker-compose.yml not found next to this script."
  [ -f "$ENV_EXAMPLE" ]  || die "${ENV_EXAMPLE} not found next to this script."

  preflight
  ensure_docker_boot

  # If a COMPLETE config already exists, don't clobber it silently. An existing but
  # empty/truncated file (missing required keys) must NOT be kept — that leaves the
  # stack without a DB password and fails cryptically — so fall through and rewrite it.
  if [ -f "$ENV_FILE" ] && env_file_complete "$ENV_FILE"; then
    keep=$(prompt_default "Existing ${ENV_FILE} found. Keep it (k) or reconfigure (r)?" "k")
    case "$keep" in
      r|R|reconfigure) : ;;   # fall through and regenerate
      *) log "keeping existing ${ENV_FILE}."; bring_up; return ;;
    esac
  elif [ -f "$ENV_FILE" ]; then
    warn "existing ${ENV_FILE} is missing required settings (POSTGRES_PASSWORD / DATABASE_URL / NEXTAUTH_SECRET); regenerating it."
  fi

  log ""
  log "Let's configure your AFCT Dashboard."

  # When we can't prompt (no terminal, or --non-interactive), every required value
  # must come from the environment; validate that here, in the main shell, so we fail
  # with a clear message instead of spinning on an unanswerable prompt. APP_URL has a
  # safe default (the hostname), so it isn't required. ADMIN_PASSWORD may be
  # auto-generated below unless --non-interactive asked for a strict, reproducible run.
  if ! can_prompt; then
    require_or_die "${ADMIN_EMAIL:-}" "ADMIN_EMAIL" \
      "Set it as an environment variable, or run on a terminal without --non-interactive."
    if [ "$NON_INTERACTIVE" = "true" ]; then
      require_or_die "${ADMIN_PASSWORD:-}" "ADMIN_PASSWORD" \
        "Set it as an environment variable (or drop --non-interactive to auto-generate one)."
    fi
  fi

  default_url="https://$(hostname 2>/dev/null || echo localhost)"
  APP_URL_IN=${APP_URL:-$(prompt_default "Public URL (how people reach the site)" "$default_url")}
  validate_app_url "$APP_URL_IN"
  ADMIN_EMAIL_IN=${ADMIN_EMAIL:-$(prompt_required "Administrator email")}
  looks_like_email "$ADMIN_EMAIL_IN" || warn "administrator email '${ADMIN_EMAIL_IN}' doesn't look like an email address."

  # Admin password: use provided, or offer to type one / auto-generate. Enforce
  # the app's policy either way, so a weak value can't slip through and fail the
  # first-run seed with a confusing container error.
  PW_POLICY_MSG="password must be 8-72 characters with an upper, a lower, a number, and a special character."
  if [ -n "${ADMIN_PASSWORD:-}" ]; then
    ADMIN_PASSWORD_IN=$ADMIN_PASSWORD
    is_strong_password "$ADMIN_PASSWORD_IN" || die "ADMIN_PASSWORD is too weak: ${PW_POLICY_MSG}"
    ADMIN_PW_GENERATED="false"
  elif ! can_prompt; then
    # No terminal to type one, and no ADMIN_PASSWORD supplied (a --non-interactive run
    # already failed above): auto-generate a strong password and show it at the end.
    ADMIN_PASSWORD_IN=$(gen_admin_password)
    ADMIN_PW_GENERATED="true"
  else
    choice=$(prompt_default "Set the admin password yourself (t) or auto-generate one (g)?" "t")
    case "$choice" in
      g|G|generate)
        ADMIN_PASSWORD_IN=$(gen_admin_password)
        ADMIN_PW_GENERATED="true"
        ;;
      *)
        # Read the password, enforce the policy, then re-enter to confirm so a typo
        # can't lock the admin out of the account it's about to seed.
        while :; do
          ADMIN_PASSWORD_IN=$(prompt_secret "Administrator password")
          if ! is_strong_password "$ADMIN_PASSWORD_IN"; then
            warn "$PW_POLICY_MSG"
            continue
          fi
          _admin_pw_confirm=$(prompt_secret "Confirm administrator password")
          [ "$ADMIN_PASSWORD_IN" = "$_admin_pw_confirm" ] && break
          warn "passwords did not match; please try again."
        done
        unset _admin_pw_confirm
        ADMIN_PW_GENERATED="false"
        ;;
    esac
  fi

  # Let the operator confirm the choices before we write config and pull images. Only
  # when there's a terminal and they didn't pass --yes; a hands-off run just proceeds.
  if can_prompt && [ "$ASSUME_YES" != "true" ]; then
    log ""
    log "Review:"
    log "   URL:        ${APP_URL_IN}"
    log "   Admin user: ${ADMIN_EMAIL_IN}"
    ans=$(prompt_default "Proceed with this configuration?" "y")
    case "$ans" in
      y|Y|yes|Yes) : ;;
      *) die "aborted at your request; re-run to reconfigure." ;;
    esac
  fi

  # Infrastructure secrets. On a RECONFIGURE, preserve the existing values instead of
  # rotating them: Postgres only reads POSTGRES_PASSWORD when it first initializes its
  # data directory, so a new password would leave the app unable to authenticate to
  # the existing database volume; and a new NEXTAUTH_SECRET would invalidate every
  # active session. Generate fresh ones only when there's no existing value.
  # (Rotating credentials for real is a separate operation that must also change the
  # password inside the running database.)
  POSTGRES_PASSWORD_IN=$(read_env_value POSTGRES_PASSWORD "$ENV_FILE")
  NEXTAUTH_SECRET_IN=$(read_env_value NEXTAUTH_SECRET "$ENV_FILE")
  [ -n "$POSTGRES_PASSWORD_IN" ] || POSTGRES_PASSWORD_IN=$(gen_secret)
  [ -n "$NEXTAUTH_SECRET_IN" ] || NEXTAUTH_SECRET_IN=$(gen_secret)

  log "writing ${ENV_FILE} ..."
  # Back up any existing config, then write to a temp file and rename it into place so
  # an interrupted write can't leave a truncated/partial .env.production behind.
  if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%Y%m%d-%H%M%S 2>/dev/null || echo prev)" 2>/dev/null || true
  fi
  tmp_env=$(mktemp "${ENV_FILE}.tmp.XXXXXX" 2>/dev/null) || die "could not create a temporary configuration file."
  {
    echo "# Generated by install.sh on $(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo unknown)."
    echo "# Keep this file secret. Regenerate secrets by re-running the installer with (r)."
    echo
    echo "NODE_ENV=production"
    echo
    echo "# --- Database (auto-generated) ---"
    echo "POSTGRES_PASSWORD=${POSTGRES_PASSWORD_IN}"
    echo "DATABASE_URL=postgresql://afct_user:${POSTGRES_PASSWORD_IN}@postgres:5432/afct"
    echo
    echo "# --- Initial admin (seeded on first run) ---"
    echo "ADMIN_EMAIL=${ADMIN_EMAIL_IN}"
    echo "ADMIN_PASSWORD=${ADMIN_PASSWORD_IN}"
    echo
    echo "# --- Auth (auto-generated) ---"
    echo "NEXTAUTH_SECRET=${NEXTAUTH_SECRET_IN}"
    echo "NEXTAUTH_URL=${APP_URL_IN}"
    echo "AUTH_TRUST_HOST=true"
  } > "$tmp_env"
  chmod 600 "$tmp_env" 2>/dev/null || true
  mv "$tmp_env" "$ENV_FILE"

  bring_up

  log ""
  log "==================================================================="
  log " AFCT Dashboard is starting."
  log "   URL:        ${APP_URL_IN}"
  log "   Admin user: ${ADMIN_EMAIL_IN}"
  if [ "${ADMIN_PW_GENERATED:-false}" = "true" ]; then
    # Show the generated password on the terminal only — sending it through log()
    # would write it to install.log and into the diagnostics bundle.
    show_secret "   Admin pass: ${ADMIN_PASSWORD_IN}   <-- save this now; it won't be shown again"
  fi
  log ""
  log " The site uses a self-signed certificate at first, so your browser will"
  log " warn you. Install a real certificate later in Admin -> System Settings."
  log ""
  log " Handy commands (run from this directory):"
  log "   sh install.sh status     # container + health status"
  log "   sh install.sh logs       # follow the application logs"
  log "   sh install.sh update     # pull the latest images and restart"
  log "==================================================================="
  DIAG_ON_EXIT="false"
}

bring_up() {
  # Fail fast on a broken compose file (missing vars, bad interpolation, invalid YAML)
  # before we touch images or containers.
  if ! compose -f "$COMPOSE_FILE" config >/dev/null 2>>"$LOG_FILE"; then
    die "the Docker Compose configuration is invalid. See ${LOG_FILE}."
  fi

  log "pulling images (first run can take a few minutes)..."
  # On a terminal, let Compose render its tidy, in-place progress UI. Piping the pull
  # (as the old code did) makes Compose think it's not a TTY and print thousands of
  # per-layer "Downloading" lines. So only capture the pull when output is redirected
  # (logged/CI), with --quiet to keep the log readable.
  #
  # NOTE: `cmd; rc=$?` does NOT work under `set -e` — a failing cmd exits before the
  # assignment runs — so capture the status with an `if`.
  pull_out="${LOG_FILE}.pull"
  : > "$pull_out"
  if [ -t 1 ]; then
    if compose -f "$COMPOSE_FILE" pull; then pull_rc=0; else pull_rc=$?; fi
  else
    if compose -f "$COMPOSE_FILE" pull --quiet > "$pull_out" 2>&1; then pull_rc=0; else pull_rc=$?; fi
    cat "$pull_out" >> "$LOG_FILE" 2>/dev/null || true
  fi
  # A failed pull is fatal: silently continuing would start the stack on stale images
  # (an unexpected version), or with images missing entirely.
  if [ "$pull_rc" -ne 0 ] || \
     grep -qiE 'unauthorized|denied|authentication required|forbidden' "$pull_out" 2>/dev/null; then
    rm -f "$pull_out" 2>/dev/null || true
    die "could not download the application images. Check your network; if they are private, run 'docker login ghcr.io' and re-run."
  fi
  log "images pulled."
  rm -f "$pull_out" 2>/dev/null || true

  log "starting the stack..."
  # Redirect to the log (not a pipe) so we get compose's real exit status; a
  # piped 'up | tee' would always look successful (tee's exit), masking failures.
  if ! compose -f "$COMPOSE_FILE" up -d >> "$LOG_FILE" 2>&1; then
    die "the stack failed to start. See ${LOG_FILE}, or run: sh install.sh diagnostics"
  fi

  log "waiting for the app to become healthy..."
  # Resolve the app container by its Compose service, not a hard-coded name, so this
  # survives a different project/name and won't collide with another AFCT install.
  app_id=$(compose -f "$COMPOSE_FILE" ps -q app 2>/dev/null || true)
  [ -n "$app_id" ] || die "the application container was not created. See ${LOG_FILE}, or run: sh install.sh diagnostics"
  i=0
  while [ "$i" -lt 60 ]; do
    state=$($DOCKER_SUDO docker inspect \
      -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' \
      "$app_id" 2>/dev/null || echo missing)
    case "$state" in
      healthy) log "app is healthy."; smoke_test; return ;;
      unhealthy) die "the app reported unhealthy. Collect logs with: sh install.sh diagnostics" ;;
    esac
    i=$((i + 1)); sleep 5
  done
  # Timed out: do NOT fall through and print "AFCT is starting" as if it succeeded.
  # die triggers the EXIT trap, which collects a diagnostics bundle.
  die "the app did not pass its health check within ~5 minutes. It may still be starting — check 'docker compose logs -f app'; a diagnostics bundle is being collected."
}

# Best-effort end-to-end check that nginx actually serves the app, not just that
# the container reports healthy. Self-signed cert on first boot, so -k.
smoke_test() {
  command -v curl >/dev/null 2>&1 || return 0
  if curl -kfsS --max-time 10 https://localhost/api/health >/dev/null 2>&1 \
     || curl -kfsS --max-time 10 http://localhost/api/health  >/dev/null 2>&1; then
    log "web front is responding at /api/health."
  else
    warn "the app is healthy but the web front didn't answer /api/health yet; nginx may still be warming up."
  fi
}

# --------------------------------------------------------------------------- #
# Operational subcommands (status / logs / update). These act on an already
# installed stack, so they only need the daemon reachable — not the full install
# preflight (Docker install, port/disk checks).
# --------------------------------------------------------------------------- #
# Determine whether we can talk to the Docker daemon directly or need sudo, and set
# DOCKER_SUDO accordingly (same resolution preflight uses, minus the install steps).
resolve_docker_sudo() {
  command -v docker >/dev/null 2>&1 || die "Docker isn't installed. Run: sh install.sh"
  if docker info >/dev/null 2>&1; then
    DOCKER_SUDO=""
  elif [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    DOCKER_SUDO="sudo"
  else
    die "the Docker daemon isn't reachable. Start Docker and try again."
  fi
}

show_status() {
  [ -f "$COMPOSE_FILE" ] || die "docker-compose.yml not found next to this script."
  resolve_docker_sudo
  log "container status:"
  compose -f "$COMPOSE_FILE" ps
  app_id=$(compose -f "$COMPOSE_FILE" ps -q app 2>/dev/null || true)
  if [ -n "$app_id" ]; then
    state=$($DOCKER_SUDO docker inspect \
      -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' \
      "$app_id" 2>/dev/null || echo unknown)
    log "app health: ${state}"
  else
    log "app container: not running (run: sh install.sh)"
  fi
}

show_logs() {
  [ -f "$COMPOSE_FILE" ] || die "docker-compose.yml not found next to this script."
  resolve_docker_sudo
  log "following app logs (Ctrl+C to stop)..."
  compose -f "$COMPOSE_FILE" logs -f --tail=200 app
}

# Pull the latest published images and recreate the stack. Reuses bring_up (the same
# config-validate / pull / start / health-wait the installer runs), so a bad image or
# an unhealthy start is fatal here too and a diagnostics bundle is collected.
do_update() {
  [ -f "$COMPOSE_FILE" ] || die "docker-compose.yml not found next to this script."
  [ -f "$ENV_FILE" ] || die "${ENV_FILE} not found; run the installer first: sh install.sh"
  resolve_docker_sudo
  DIAG_ON_EXIT="true"
  log "updating AFCT to the latest images..."
  bring_up
  DIAG_ON_EXIT="false"
  log "update complete."
}

# --------------------------------------------------------------------------- #
# Entry
# --------------------------------------------------------------------------- #
case "$MODE" in
  help)
    usage
    ;;
  diagnostics)
    collect_diagnostics
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
  install)
    init_log
    do_install
    ;;
esac
