#!/bin/sh
# AFCT Dashboard — Linux / macOS installer.
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
# The script is self-contained: it only needs Docker (with the Compose plugin)
# and this folder's docker-compose.yml + .env.production.example.

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
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    return 127
  fi
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
  docker version > "$work/docker-version.txt" 2>&1 || true
  docker info    > "$work/docker-info.txt"    2>&1 || true

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
# Preflight
# --------------------------------------------------------------------------- #
preflight() {
  log "checking prerequisites..."

  if ! command -v docker >/dev/null 2>&1; then
    errln "Docker is not installed."
    errln "Install it first: https://docs.docker.com/engine/install/ (Linux) or Docker Desktop (macOS)."
    die "missing Docker"
  fi

  if ! docker info >/dev/null 2>&1; then
    die "Docker is installed but the daemon isn't reachable. Start Docker and re-run."
  fi

  if ! compose version >/dev/null 2>&1; then
    die "Docker Compose plugin not found. Install the 'docker compose' plugin and re-run."
  fi

  # openssl backs the generated secrets.
  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets."

  # Best-effort port check (warn only — the user may intend to change ports).
  for port in 80 443; do
    if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":${port} "; then
      warn "port ${port} looks busy; the web front may fail to bind it."
    fi
  done

  log "prerequisites OK."
}

# --------------------------------------------------------------------------- #
# Secret generation
# --------------------------------------------------------------------------- #
gen_secret() {
  # url-safe-ish token of ~40 chars
  openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-40
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

  # If a config already exists, don't clobber it silently.
  if [ -f "$ENV_FILE" ]; then
    keep=$(prompt_default "Existing ${ENV_FILE} found. Keep it (k) or reconfigure (r)?" "k")
    case "$keep" in
      r|R|reconfigure) : ;;   # fall through and regenerate
      *) log "keeping existing ${ENV_FILE}."; bring_up; return ;;
    esac
  fi

  log ""
  log "Let's configure your AFCT Dashboard."

  default_url="https://$(hostname 2>/dev/null || echo localhost)"
  APP_URL_IN=${APP_URL:-$(prompt_default "Public URL (how people reach the site)" "$default_url")}
  ADMIN_EMAIL_IN=${ADMIN_EMAIL:-$(prompt_required "Administrator email")}

  # Admin password: use provided, or offer to type one / auto-generate.
  if [ -n "${ADMIN_PASSWORD:-}" ]; then
    ADMIN_PASSWORD_IN=$ADMIN_PASSWORD
    ADMIN_PW_GENERATED="false"
  else
    choice=$(prompt_default "Set the admin password yourself (t) or auto-generate one (g)?" "t")
    case "$choice" in
      g|G|generate)
        ADMIN_PASSWORD_IN=$(gen_secret)
        ADMIN_PW_GENERATED="true"
        ;;
      *)
        ADMIN_PASSWORD_IN=$(prompt_secret "Administrator password")
        [ -n "$ADMIN_PASSWORD_IN" ] || die "admin password cannot be empty."
        ADMIN_PW_GENERATED="false"
        ;;
    esac
  fi

  # Auto-generated infrastructure secrets — never prompted.
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
  log "  (if the images are private, log in first: docker login ghcr.io)"
  compose -f "$COMPOSE_FILE" pull 2>&1 | tee -a "$LOG_FILE" || true

  log "starting the stack..."
  compose -f "$COMPOSE_FILE" up -d 2>&1 | tee -a "$LOG_FILE" \
    || die "the stack failed to start."

  log "waiting for the app to become healthy..."
  i=0
  while [ "$i" -lt 60 ]; do
    state=$(docker inspect -f '{{ .State.Health.Status }}' afct-app 2>/dev/null || echo "starting")
    case "$state" in
      healthy) log "app is healthy."; return ;;
      unhealthy) die "app reported unhealthy; check logs (./install.sh diagnostics)." ;;
    esac
    i=$((i + 1)); sleep 5
  done
  warn "app did not report healthy within ~5 min; it may still be migrating. Check: docker compose logs -f app"
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
