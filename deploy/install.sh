#!/bin/sh
# AFCT Dashboard: Linux / macOS installer.
#
# Usage:
#   sh install.sh              Run the guided install (default).
#   sh install.sh diagnostics  Collect a support zip (redacted) and exit.
#   sh install.sh --help
#
# Non-interactive install (advanced): set the prompted values as env vars and
# pass --yes, e.g.
#   ADMIN_EMAIL=admin@x.edu ADMIN_PASSWORD=... APP_URL=https://afct.x.edu \
#     sh install.sh --yes
#
# The script is self-contained: on Linux it installs Docker for you if it's
# missing (via the official get.docker.com script); otherwise it just needs
# Docker with the Compose plugin, plus this folder's docker-compose.yml and
# .env.production.example.

set -eu

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

ASSUME_YES="false"
MODE="install"
DOCKER_SUDO=""                              # set to "sudo" at preflight if the daemon needs it
OS=$(uname -s 2>/dev/null || echo unknown)  # Linux / Darwin

for arg in "$@"; do
  case "$arg" in
    diagnostics|--diagnostics) MODE="diagnostics" ;;
    -y|--yes) ASSUME_YES="true" ;;
    -h|--help) MODE="help" ;;
    *) ;;
  esac
done

# --------------------------------------------------------------------------- #
# Output helpers (everything is teed to the install log)
# --------------------------------------------------------------------------- #
: > "$LOG_FILE" 2>/dev/null || true
log()  { printf '[afct] %s\n' "$*" | tee -a "$LOG_FILE"; }
warn() { printf '[afct] WARNING: %s\n' "$*" | tee -a "$LOG_FILE" >&2; }
errln(){ printf '[afct] ERROR: %s\n' "$*" | tee -a "$LOG_FILE" >&2; }
ask()  { printf '%s' "$1" >&2; }

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
  log "Secret values were redacted. Send this file to your administrator for help."
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

  log "Docker isn't installed."
  if [ "$ASSUME_YES" != "true" ]; then
    ans=$(prompt_default "Install Docker now via the official get.docker.com script?" "y")
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

  log "installing Docker (this can take a few minutes)..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | $ins_sudo sh 2>&1 | tee -a "$LOG_FILE"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://get.docker.com | $ins_sudo sh 2>&1 | tee -a "$LOG_FILE"
  else
    die "need curl or wget to download the Docker installer. Install one and re-run."
  fi

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
  compose version >/dev/null 2>&1 && return 0
  command -v docker-compose >/dev/null 2>&1 && return 0

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
prompt_default() { # prompt_default "Question" "default" -> echoes answer
  q=$1; d=$2
  if [ "$ASSUME_YES" = "true" ]; then printf '%s' "$d"; return; fi
  ask "$q [$d]: "
  IFS= read -r ans || ans=""
  [ -n "$ans" ] && printf '%s' "$ans" || printf '%s' "$d"
}

prompt_required() { # prompt_required "Question" -> echoes non-empty answer
  q=$1
  while :; do
    ask "$q: "
    IFS= read -r ans || ans=""
    [ -n "$ans" ] && { printf '%s' "$ans"; return; }
    warn "a value is required."
  done
}

prompt_secret() { # prompt_secret "Question" -> echoes typed value (no echo to screen)
  q=$1
  ask "$q: "
  stty -echo 2>/dev/null || true
  IFS= read -r ans || ans=""
  stty echo 2>/dev/null || true
  printf '\n' >&2
  printf '%s' "$ans"
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

  # Auto-generated infrastructure secrets, never prompted.
  POSTGRES_PASSWORD_IN=$(gen_secret)
  NEXTAUTH_SECRET_IN=$(gen_secret)

  log "writing ${ENV_FILE} ..."
  umask 077
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
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true

  bring_up

  log ""
  log "==================================================================="
  log " AFCT Dashboard is starting."
  log "   URL:        ${APP_URL_IN}"
  log "   Admin user: ${ADMIN_EMAIL_IN}"
  if [ "${ADMIN_PW_GENERATED:-false}" = "true" ]; then
    log "   Admin pass: ${ADMIN_PASSWORD_IN}   <-- save this now; it won't be shown again"
  fi
  log ""
  log " The site uses a self-signed certificate at first, so your browser will"
  log " warn you. Install a real certificate later in Admin -> System Settings."
  log "==================================================================="
  DIAG_ON_EXIT="false"
}

bring_up() {
  log "pulling images (first run can take a few minutes)..."
  # On a terminal, let Compose render its tidy, in-place progress UI. The old code
  # piped the pull through `tee`, which makes Compose think it's not a TTY and fall
  # back to *plain* output — thousands of per-layer "Downloading" lines that flood
  # the screen and the log. So only capture the pull when output is redirected
  # (logged/CI), and use --quiet there to keep the log readable. Either branch keeps
  # Compose's real exit status (not tee's), so a private-registry 401 still surfaces.
  pull_out="${LOG_FILE}.pull"
  : > "$pull_out"
  if [ -t 1 ]; then
    compose -f "$COMPOSE_FILE" pull
    pull_rc=$?
  else
    compose -f "$COMPOSE_FILE" pull --quiet > "$pull_out" 2>&1
    pull_rc=$?
    cat "$pull_out" >> "$LOG_FILE" 2>/dev/null || true
  fi
  if [ "$pull_rc" -ne 0 ] || \
     grep -qiE 'unauthorized|denied|authentication required|forbidden' "$pull_out" 2>/dev/null; then
    warn "some images could not be pulled. Check your network; if they are private, run 'docker login ghcr.io' and re-run."
  else
    log "images pulled."
  fi
  rm -f "$pull_out" 2>/dev/null || true

  log "starting the stack..."
  # Redirect to the log (not a pipe) so we get compose's real exit status; a
  # piped 'up | tee' would always look successful (tee's exit), masking failures.
  if ! compose -f "$COMPOSE_FILE" up -d >> "$LOG_FILE" 2>&1; then
    die "the stack failed to start. See ${LOG_FILE}, or run: sh install.sh diagnostics"
  fi

  log "waiting for the app to become healthy..."
  i=0
  while [ "$i" -lt 60 ]; do
    state=$($DOCKER_SUDO docker inspect -f '{{ .State.Health.Status }}' afct-app 2>/dev/null || echo "starting")
    case "$state" in
      healthy) log "app is healthy."; smoke_test; return ;;
      unhealthy) die "app reported unhealthy; check logs (sh install.sh diagnostics)." ;;
    esac
    i=$((i + 1)); sleep 5
  done
  warn "app did not report healthy within ~5 min; it may still be migrating. Check: docker compose logs -f app"
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
# Entry
# --------------------------------------------------------------------------- #
case "$MODE" in
  help)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  diagnostics)
    collect_diagnostics
    ;;
  install)
    do_install
    ;;
esac
