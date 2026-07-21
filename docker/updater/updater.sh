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
# The curated release manifest, fetched over HTTPS so a deployed host learns about
# new releases without redeploying versions.json. This is the authoritative allow
# list (independent of the app, which only requests a tag). MANIFEST_FILE above is
# the fallback when the remote is unreachable. Set empty to disable the remote fetch
# (the test harness does this to stay offline and deterministic).
MANIFEST_URL="${UPDATER_MANIFEST_URL:-https://raw.githubusercontent.com/PennStateCS/AFCT/main/deploy/versions.json}"

APP_SERVICE="${AFCT_APP_SERVICE:-app}"
APP_CONTAINER="${AFCT_APP_CONTAINER:-afct-app}"
# Sidecars versioned in lockstep with the app; recreated together on an upgrade.
# Postgres (digest-pinned) and this updater are deliberately excluded — the updater
# cannot recreate its own container mid-run, so its new image is picked up by the
# next host-side `docker compose pull`.
NGINX_SERVICE="${AFCT_NGINX_SERVICE:-nginx}"
BACKUP_SERVICE="${AFCT_BACKUP_SERVICE:-db-backup}"
STACK_SERVICES="${AFCT_STACK_SERVICES:-$APP_SERVICE $NGINX_SERVICE $BACKUP_SERVICE}"
IMAGE_REPO="${UPDATER_IMAGE_REPO:-ghcr.io/pennstatecs/afct-dashboard}"
DEFAULT_TAG="${UPDATER_DEFAULT_TAG:-main}"

BACKUP_TRIGGER_DIR="${BACKUP_TRIGGER_DIR:-/backup-triggers}"
BACKUP_TRIGGER_FILE="${BACKUP_TRIGGER_DIR}/backup-now"
# Downgrade restore: signal the backup sidecar and read its result (shared volume).
RESTORE_TRIGGER_FILE="${BACKUP_TRIGGER_DIR}/restore-now"
RESTORE_RESULT_FILE="${BACKUP_TRIGGER_DIR}/restore-result"
BACKUP_DIR="${UPDATER_BACKUP_DIR:-/backups}"
# The version<->backup map, so a downgrade knows which backup to restore. Written
# here (the app reads it to offer downgrade options).
RESTORE_POINTS_FILE="${TRIGGER_DIR}/restore-points.json"

HEALTH_TIMEOUT="${UPDATER_HEALTH_TIMEOUT:-300}"
HEALTH_INTERVAL="${UPDATER_HEALTH_INTERVAL:-5}"
BACKUP_TIMEOUT="${UPDATER_BACKUP_TIMEOUT:-600}"
RESTORE_TIMEOUT="${UPDATER_RESTORE_TIMEOUT:-600}"
POLL_INTERVAL="${UPDATER_POLL_INTERVAL:-5}"
REQUIRE_BACKUP="${UPDATER_REQUIRE_BACKUP:-false}"
ONCE="${UPDATER_ONCE:-false}"

# Liveness heartbeat for the container healthcheck. Each poll (and each wait
# iteration during a long upgrade) stamps the current epoch here, so the healthcheck
# can tell a live-but-idle watcher from a hung one — a bare "Up" cannot.
HEARTBEAT_FILE="${UPDATER_HEARTBEAT_FILE:-/tmp/afct-updater.alive}"
# A second heartbeat in the SHARED trigger volume. The app can't see Docker, so this
# is how it tells whether the updater sidecar is actually installed and running: the
# Updates tab reads it and, when it's missing or stale, shows "not installed"
# guidance instead of an upgrade button that would do nothing.
PRESENCE_FILE="${UPDATER_PRESENCE_FILE:-${TRIGGER_DIR}/updater.alive}"
beat() {
  _beat_now=$(date +%s)
  printf '%s\n' "$_beat_now" > "$HEARTBEAT_FILE" 2>/dev/null || true
  printf '%s\n' "$_beat_now" > "$PRESENCE_FILE" 2>/dev/null || true
}

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
  # We run as root but the file belongs to the non-root install user; capture its
  # ownership so we can restore it after the rewrite. Otherwise the file becomes
  # root-owned and the next host-side `install.sh` (run by that user) can't read it.
  _owner=$(stat -c '%u:%g' "$ENV_FILE" 2>/dev/null || true)
  if grep -qE '^AFCT_APP_TAG=' "$ENV_FILE" 2>/dev/null; then
    awk -v t="$_tag" '/^AFCT_APP_TAG=/ { print "AFCT_APP_TAG=" t; next } { print }' \
      "$ENV_FILE" > "$_tmp" || return 1
  else
    { cat "$ENV_FILE" && printf 'AFCT_APP_TAG=%s\n' "$_tag"; } > "$_tmp" || return 1
  fi
  chmod 600 "$_tmp" 2>/dev/null || true
  [ -n "$_owner" ] && chown "$_owner" "$_tmp" 2>/dev/null || true
  # Same directory as the target, so this rename is atomic and stays on the host
  # filesystem (the deploy directory is bind-mounted, not the single file).
  mv "$_tmp" "$ENV_FILE" || { rm -f "$_tmp"; return 1; }
  return 0
}

recreate_app() {
  _proj=$1
  # Pull + recreate the app and its lockstep sidecars (nginx, backup) at the selected
  # tag. Word-splitting of STACK_SERVICES is intentional (a list of service names).
  # shellcheck disable=SC2086
  dc "$_proj" pull $STACK_SERVICES >/dev/null 2>&1 || return 1
  # shellcheck disable=SC2086
  dc "$_proj" up -d $STACK_SERVICES >/dev/null 2>&1 || return 1
  return 0
}

wait_for_health() {
  _proj=$1
  _elapsed=0
  while [ "$_elapsed" -lt "$HEALTH_TIMEOUT" ]; do
    beat
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
# appear. On success, echoes the new backup's timestamp (so the caller can record a
# restore point). Best-effort: the image rollback still protects an upgrade.
backup_and_wait() {
  _before=$(ls -1t "$BACKUP_DIR"/afct-*.dump 2>/dev/null | head -n 1 || true)
  mkdir -p "$BACKUP_TRIGGER_DIR" 2>/dev/null || return 1
  : > "$BACKUP_TRIGGER_FILE" 2>/dev/null || return 1
  _elapsed=0
  while [ "$_elapsed" -lt "$BACKUP_TIMEOUT" ]; do
    beat
    _now=$(ls -1t "$BACKUP_DIR"/afct-*.dump 2>/dev/null | head -n 1 || true)
    if [ -n "$_now" ] && [ "$_now" != "$_before" ]; then
      basename "$_now" | sed -n 's/^afct-\(.*\)\.dump$/\1/p'
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
    _elapsed=$((_elapsed + HEALTH_INTERVAL))
  done
  return 1
}

# Append (version -> backup timestamp) to the restore-points map, de-duplicated by
# backup. The app reads this to offer downgrade targets.
record_restore_point() {
  _ver=$1
  _bts=$2
  [ -n "$_ver" ] && [ -n "$_bts" ] || return 0
  _rts=$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf 'unknown')
  _tmp="${RESTORE_POINTS_FILE}.tmp.$$"
  if [ -f "$RESTORE_POINTS_FILE" ] && jq -e . "$RESTORE_POINTS_FILE" >/dev/null 2>&1; then
    jq --arg v "$_ver" --arg b "$_bts" --arg t "$_rts" \
      '(map(select(.backup != $b))) + [{version: $v, backup: $b, createdAt: $t}]' \
      "$RESTORE_POINTS_FILE" > "$_tmp" 2>/dev/null || return 0
  else
    jq -n --arg v "$_ver" --arg b "$_bts" --arg t "$_rts" \
      '[{version: $v, backup: $b, createdAt: $t}]' > "$_tmp" 2>/dev/null || return 0
  fi
  mv "$_tmp" "$RESTORE_POINTS_FILE" 2>/dev/null || true
}

# Wait for the backup sidecar to report the outcome of a restore.
wait_for_restore() {
  _elapsed=0
  while [ "$_elapsed" -lt "$RESTORE_TIMEOUT" ]; do
    beat
    if [ -f "$RESTORE_RESULT_FILE" ]; then
      case "$(cat "$RESTORE_RESULT_FILE" 2>/dev/null || printf '')" in
        ok*) return 0 ;;
        failed*) return 1 ;;
      esac
    fi
    sleep "$HEALTH_INTERVAL"
    _elapsed=$((_elapsed + HEALTH_INTERVAL))
  done
  return 1
}

tag_allowed() {
  _tag=$1
  printf '%s' "$_tag" | grep -Eq "$TAG_REGEX" || return 1
  # The curated manifest is authoritative: prefer the remote copy (so releases
  # published after this host was deployed are still allowed), fall back to a local
  # file, and only if neither is reachable fall back to the character allowlist alone.
  if [ -n "$MANIFEST_URL" ]; then
    _remote=$(curl -fsS --max-time 10 "$MANIFEST_URL" 2>/dev/null || true)
    if [ -n "$_remote" ]; then
      printf '%s' "$_remote" | jq -e --arg t "$_tag" '(.versions // []) | any(.tag == $t)' >/dev/null 2>&1 || return 1
      return 0
    fi
  fi
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
  _restore_point=$(jq -r '.restorePoint // ""' "$CLAIM_FILE" 2>/dev/null || printf '')
  printf '%s' "$_rid" | grep -Eq "$ID_REGEX" || _rid="unknown"

  case "$_action" in
    upgrade | downgrade) : ;;
    *)
      write_status "failed" "unsupported action: ${_action}" "" "" "$_rid"
      rm -f "$CLAIM_FILE"
      return 0
      ;;
  esac

  # Tag character-safety applies to both actions (it's written to the env file).
  if ! printf '%s' "$_tag" | grep -Eq "$TAG_REGEX"; then
    write_status "failed" "invalid version tag" "" "$_tag" "$_rid"
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

  if [ "$_action" = "downgrade" ]; then
    process_downgrade "$_tag" "$_rid" "$_from" "$_proj" "$_restore_point"
    rm -f "$CLAIM_FILE"
    return 0
  fi

  # ---- upgrade ----
  # The target must be a curated release (downgrade targets are validated against
  # the recorded restore points instead, in process_downgrade).
  if ! tag_allowed "$_tag"; then
    write_status "failed" "version is not an allowed release" "$_from" "$_tag" "$_rid"
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
    _bts=$(backup_and_wait) || _bts=""
    if [ -n "$_bts" ]; then
      # Remember this backup as the restore point for the version we're leaving.
      record_restore_point "$_from" "$_bts"
    elif [ "$REQUIRE_BACKUP" = "true" ]; then
      write_status "failed" "a pre-upgrade backup could not be confirmed" "$_from" "$_tag" "$_rid"
      rm -f "$CLAIM_FILE"
      return 0
    else
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

# Downgrade = restore a recorded pre-upgrade database backup and run the older
# image. DESTRUCTIVE: it discards everything created since that backup. The app is
# stopped, the backup sidecar restores the DB, then the old image is started.
process_downgrade() {
  _tag=$1
  _rid=$2
  _from=$3
  _proj=$4
  _rp=$5

  # The restore point is a backup timestamp; it must be a recorded restore point
  # for exactly this version (the app never gets to name an arbitrary backup).
  case "$_rp" in
    '' | *[!0-9-]*)
      write_status "failed" "invalid restore point" "$_from" "$_tag" "$_rid"
      return 0
      ;;
  esac
  if ! { [ -f "$RESTORE_POINTS_FILE" ] && jq -e --arg t "$_tag" --arg b "$_rp" \
       'any(.[]?; .version == $t and .backup == $b)' "$RESTORE_POINTS_FILE" >/dev/null 2>&1; }; then
    write_status "failed" "no recorded restore point ${_rp} for ${_tag}" "$_from" "$_tag" "$_rid"
    return 0
  fi

  log "downgrade requested: ${_from} -> ${_tag} via restore ${_rp} (request ${_rid})"

  # 1) Snapshot the CURRENT state first, so this downgrade is itself reversible.
  write_status "backing_up" "backing up the current state before downgrading" "$_from" "$_tag" "$_rid"
  _sbts=$(backup_and_wait) || _sbts=""
  if [ -n "$_sbts" ]; then
    record_restore_point "$_from" "$_sbts"
  else
    log "safety backup before downgrade not confirmed; continuing"
  fi

  # 2) Stop the app so pg_restore --clean has no live database connections.
  write_status "stopping" "stopping the application for the restore" "$_from" "$_tag" "$_rid"
  dc "$_proj" stop "$APP_SERVICE" >/dev/null 2>&1 || true

  # 3) Ask the backup sidecar to restore the chosen database, and wait for it.
  write_status "restoring" "restoring the database from ${_rp}" "$_from" "$_tag" "$_rid"
  rm -f "$RESTORE_RESULT_FILE" 2>/dev/null || true
  mkdir -p "$BACKUP_TRIGGER_DIR" 2>/dev/null || true
  if ! printf '%s\n' "$_rp" > "$RESTORE_TRIGGER_FILE" 2>/dev/null; then
    write_status "failed" "could not signal the backup service to restore" "$_from" "$_tag" "$_rid"
    return 0
  fi
  if ! wait_for_restore; then
    write_status "failed" "the database restore did not complete; the app is stopped. Recover from a restore point." "$_from" "$_tag" "$_rid"
    return 0
  fi

  # 4) Set the old version and bring the app back on it.
  write_status "pulling" "starting ${_tag}" "$_from" "$_tag" "$_rid"
  if ! set_app_tag "$_tag"; then
    write_status "failed" "restored the database but could not set the version" "$_from" "$_tag" "$_rid"
    return 0
  fi
  if recreate_app "$_proj" && wait_for_health "$_proj"; then
    write_status "healthy" "downgraded to ${_tag}" "$_from" "$_tag" "$_rid"
    log "downgrade to ${_tag} complete"
  else
    write_status "failed" "restored the database, but ${_tag} did not become healthy; recover from a restore point" "$_from" "$_tag" "$_rid"
  fi
  return 0
}

# --------------------------------------------------------------------------- #
# Main loop
# --------------------------------------------------------------------------- #
log "AFCT updater started (watching ${TRIGGER_DIR})"
beat

# Recover a claim left behind by a crash mid-upgrade: retry it once.
[ -f "$CLAIM_FILE" ] && mv "$CLAIM_FILE" "$REQUEST_FILE" 2>/dev/null || true

while :; do
  beat
  if [ -f "$REQUEST_FILE" ]; then
    process_request || log "request processing raised an unexpected error"
  fi
  [ "$ONCE" = "true" ] && break
  sleep "$POLL_INTERVAL"
done
