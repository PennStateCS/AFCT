#!/bin/sh
# AFCT updater sidecar.
#
# Performs admin-requested application upgrades: it swaps the app image tag,
# backs up first, health-checks, and rolls back on failure. It holds the Docker
# socket so the application never has to. The app can ONLY request work by
# dropping a JSON file in the shared trigger volume; this process validates every
# request and is the sole component that talks to Docker.
#
# Trust boundary: the app supplies a version TAG only. The image repository is
# fixed by the Compose file, so a request can never pull an arbitrary image; the
# tag is validated against a strict character allowlist and, when present, the
# curated release manifest. The tag is written to the env file with awk (never
# shell-evaluated), so it cannot inject commands.

set -u

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
TRIGGER_DIR="${UPDATER_TRIGGER_DIR:-/update-triggers}"
REQUEST_FILE="${TRIGGER_DIR}/request.json"
STATUS_FILE="${TRIGGER_DIR}/status.json"
CLAIM_FILE="${TRIGGER_DIR}/.processing.json"

COMPOSE_FILE="${UPDATER_COMPOSE_FILE:-/afct/docker-compose.yml}"
ENV_FILE="${UPDATER_ENV_FILE:-/afct/.env.production}"
MANIFEST_FILE="${UPDATER_MANIFEST_FILE:-/afct/versions.json}"

APP_SERVICE="${AFCT_APP_SERVICE:-app}"
APP_CONTAINER="${AFCT_APP_CONTAINER:-afct-app}"
IMAGE_REPO="${UPDATER_IMAGE_REPO:-ghcr.io/pennstatewilkes-barre/afct-dashboard}"
DEFAULT_TAG="${UPDATER_DEFAULT_TAG:-main}"

BACKUP_TRIGGER_DIR="${BACKUP_TRIGGER_DIR:-/backup-triggers}"
BACKUP_TRIGGER_FILE="${BACKUP_TRIGGER_DIR}/backup-now"
BACKUP_DIR="${UPDATER_BACKUP_DIR:-/backups}"

HEALTH_TIMEOUT="${UPDATER_HEALTH_TIMEOUT:-300}"
HEALTH_INTERVAL="${UPDATER_HEALTH_INTERVAL:-5}"
BACKUP_TIMEOUT="${UPDATER_BACKUP_TIMEOUT:-600}"
POLL_INTERVAL="${UPDATER_POLL_INTERVAL:-5}"
REQUIRE_BACKUP="${UPDATER_REQUIRE_BACKUP:-false}"
ONCE="${UPDATER_ONCE:-false}"

# Docker tags: letters, digits, and . _ - only; up to 128 chars; not starting
# with a separator. This blocks whitespace, slashes, and shell metacharacters.
TAG_REGEX='^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
# requestId is echoed back into status.json, so constrain it too.
ID_REGEX='^[A-Za-z0-9._-]{1,128}$'

log() { printf '[afct-updater] %s\n' "$*"; }

# --------------------------------------------------------------------------- #
# Status reporting (written to the shared volume; read by the app)
# --------------------------------------------------------------------------- #
write_status() {
  # phase message fromTag toTag requestId
  _now=$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf 'unknown')
  jq -n \
    --arg requestId "${5:-}" \
    --arg phase "${1:-}" \
    --arg message "${2:-}" \
    --arg fromTag "${3:-}" \
    --arg toTag "${4:-}" \
    --arg updatedAt "$_now" \
    '{requestId:$requestId, phase:$phase, message:$message, fromTag:$fromTag, toTag:$toTag, updatedAt:$updatedAt}' \
    > "${STATUS_FILE}.tmp" 2>/dev/null && mv "${STATUS_FILE}.tmp" "$STATUS_FILE" 2>/dev/null || \
    log "could not write status: ${1:-} ${2:-}"
}

# --------------------------------------------------------------------------- #
# Compose helpers. The updater targets the SAME Compose project the stack was
# deployed with, discovered from the running app container's labels, so it
# recreates the existing app (and reuses its volumes) rather than a new stack.
# --------------------------------------------------------------------------- #
compose_project() {
  docker inspect "$APP_CONTAINER" \
    --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true
}

dc() {
  # docker compose for a given project, using the deployed compose + env files.
  _proj=$1
  shift
  docker compose -p "$_proj" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

current_app_tag() {
  _v=$(awk -F= '/^AFCT_APP_TAG=/ { sub(/^AFCT_APP_TAG=/, ""); print; exit }' "$ENV_FILE" 2>/dev/null || true)
  [ -n "$_v" ] && printf '%s' "$_v" || printf '%s' "$DEFAULT_TAG"
}

# Rewrite only the AFCT_APP_TAG line, preserving every other line (and the file's
# secrets). Writes in place so a bind-mounted env file is updated on the host.
set_app_tag() {
  _tag=$1
  _tmp="${ENV_FILE}.updtmp.$$"
  if grep -qE '^AFCT_APP_TAG=' "$ENV_FILE" 2>/dev/null; then
    awk -v t="$_tag" '/^AFCT_APP_TAG=/ { print "AFCT_APP_TAG=" t; next } { print }' \
      "$ENV_FILE" > "$_tmp" || return 1
  else
    { cat "$ENV_FILE" && printf 'AFCT_APP_TAG=%s\n' "$_tag"; } > "$_tmp" || return 1
  fi
  chmod 600 "$_tmp" 2>/dev/null || true
  # Same directory as the target, so this rename is atomic and stays on the host
  # filesystem (the deploy directory is bind-mounted, not the single file).
  mv "$_tmp" "$ENV_FILE" || { rm -f "$_tmp"; return 1; }
  return 0
}

recreate_app() {
  _proj=$1
  dc "$_proj" pull "$APP_SERVICE" >/dev/null 2>&1 || return 1
  dc "$_proj" up -d "$APP_SERVICE" >/dev/null 2>&1 || return 1
  return 0
}

wait_for_health() {
  _proj=$1
  _elapsed=0
  while [ "$_elapsed" -lt "$HEALTH_TIMEOUT" ]; do
    _id=$(dc "$_proj" ps -q "$APP_SERVICE" 2>/dev/null || true)
    if [ -n "$_id" ]; then
      _state=$(docker inspect \
        -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
        "$_id" 2>/dev/null || printf 'missing|none')
      case "$_state" in
        running\|healthy) return 0 ;;
        running\|unhealthy) return 1 ;;
        exited\|*|dead\|*) return 1 ;;
      esac
    fi
    sleep "$HEALTH_INTERVAL"
    _elapsed=$((_elapsed + HEALTH_INTERVAL))
  done
  return 1
}

# Ask the existing backup sidecar for a fresh backup and wait for a new dump to
# appear. Best-effort by default: the image rollback still protects the upgrade.
backup_and_wait() {
  _before=$(ls -1t "$BACKUP_DIR"/afct-*.dump 2>/dev/null | head -n 1 || true)
  mkdir -p "$BACKUP_TRIGGER_DIR" 2>/dev/null || return 1
  : > "$BACKUP_TRIGGER_FILE" 2>/dev/null || return 1
  _elapsed=0
  while [ "$_elapsed" -lt "$BACKUP_TIMEOUT" ]; do
    _now=$(ls -1t "$BACKUP_DIR"/afct-*.dump 2>/dev/null | head -n 1 || true)
    if [ -n "$_now" ] && [ "$_now" != "$_before" ]; then
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
    _elapsed=$((_elapsed + HEALTH_INTERVAL))
  done
  return 1
}

tag_allowed() {
  _tag=$1
  printf '%s' "$_tag" | grep -Eq "$TAG_REGEX" || return 1
  # When a curated manifest is present it is authoritative: the tag must be listed.
  if [ -f "$MANIFEST_FILE" ]; then
    jq -e --arg t "$_tag" '(.versions // []) | any(.tag == $t)' "$MANIFEST_FILE" >/dev/null 2>&1 || return 1
  fi
  return 0
}

# --------------------------------------------------------------------------- #
# Request processing
# --------------------------------------------------------------------------- #
process_request() {
  # Atomically claim the request so a rewrite mid-read can't be half-processed.
  mv "$REQUEST_FILE" "$CLAIM_FILE" 2>/dev/null || return 0

  if ! jq -e . "$CLAIM_FILE" >/dev/null 2>&1; then
    write_status "failed" "the update request was not valid JSON" "" "" "unknown"
    rm -f "$CLAIM_FILE"
    return 0
  fi

  _action=$(jq -r '.action // ""' "$CLAIM_FILE" 2>/dev/null || printf '')
  _tag=$(jq -r '.tag // ""' "$CLAIM_FILE" 2>/dev/null || printf '')
  _rid=$(jq -r '.requestId // ""' "$CLAIM_FILE" 2>/dev/null || printf '')
  _backup=$(jq -r 'if .backupFirst == false then "false" else "true" end' "$CLAIM_FILE" 2>/dev/null || printf 'true')
  printf '%s' "$_rid" | grep -Eq "$ID_REGEX" || _rid="unknown"

  if [ "$_action" != "upgrade" ]; then
    write_status "failed" "unsupported action: ${_action}" "" "" "$_rid"
    rm -f "$CLAIM_FILE"
    return 0
  fi

  if ! tag_allowed "$_tag"; then
    write_status "failed" "version is not an allowed release" "" "$_tag" "$_rid"
    rm -f "$CLAIM_FILE"
    return 0
  fi

  _from=$(current_app_tag)
  _proj=$(compose_project)
  if [ -z "$_proj" ]; then
    write_status "failed" "could not find the running app container (${APP_CONTAINER})" "$_from" "$_tag" "$_rid"
    rm -f "$CLAIM_FILE"
    return 0
  fi

  if [ "$_tag" = "$_from" ]; then
    write_status "healthy" "already running ${_tag}" "$_from" "$_tag" "$_rid"
    rm -f "$CLAIM_FILE"
    return 0
  fi

  log "upgrade requested: ${_from} -> ${_tag} (project ${_proj}, request ${_rid})"

  if [ "$_backup" = "true" ]; then
    write_status "backing_up" "creating a pre-upgrade backup" "$_from" "$_tag" "$_rid"
    if ! backup_and_wait; then
      if [ "$REQUIRE_BACKUP" = "true" ]; then
        write_status "failed" "a pre-upgrade backup could not be confirmed" "$_from" "$_tag" "$_rid"
        rm -f "$CLAIM_FILE"
        return 0
      fi
      log "pre-upgrade backup not confirmed; continuing (image rollback still protects this upgrade)"
    fi
  fi

  write_status "pulling" "downloading ${IMAGE_REPO}:${_tag}" "$_from" "$_tag" "$_rid"
  if ! set_app_tag "$_tag"; then
    write_status "failed" "could not update the version in the environment file" "$_from" "$_tag" "$_rid"
    rm -f "$CLAIM_FILE"
    return 0
  fi

  if recreate_app "$_proj"; then
    write_status "migrating" "waiting for ${_tag} to become healthy" "$_from" "$_tag" "$_rid"
    if wait_for_health "$_proj"; then
      write_status "healthy" "upgraded to ${_tag}" "$_from" "$_tag" "$_rid"
      log "upgrade to ${_tag} complete"
      rm -f "$CLAIM_FILE"
      return 0
    fi
  fi

  # Roll back to the previous tag.
  write_status "rolling_back" "the upgrade failed; restoring ${_from}" "$_from" "$_tag" "$_rid"
  log "upgrade to ${_tag} failed; rolling back to ${_from}"
  if set_app_tag "$_from" && recreate_app "$_proj" && wait_for_health "$_proj"; then
    write_status "rolled_back" "restored ${_from} after a failed upgrade to ${_tag}" "$_from" "$_tag" "$_rid"
  else
    write_status "failed" "the upgrade and the rollback both failed; manual recovery is required" "$_from" "$_tag" "$_rid"
  fi
  rm -f "$CLAIM_FILE"
  return 0
}

# --------------------------------------------------------------------------- #
# Main loop
# --------------------------------------------------------------------------- #
log "AFCT updater started (watching ${TRIGGER_DIR})"

# Recover a claim left behind by a crash mid-upgrade: retry it once.
[ -f "$CLAIM_FILE" ] && mv "$CLAIM_FILE" "$REQUEST_FILE" 2>/dev/null || true

while :; do
  if [ -f "$REQUEST_FILE" ]; then
    process_request || log "request processing raised an unexpected error"
  fi
  [ "$ONCE" = "true" ] && break
  sleep "$POLL_INTERVAL"
done
