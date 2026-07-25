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
# Append-only, size-capped live log of the current upgrade's shell output (image
# pull + container recreate) plus periodic heartbeat lines. The app tails this over
# SSE so the Updates UI shows what's happening in real time instead of sitting on a
# static phase during the long (~4.7GB) pull. Reset at the start of each upgrade.
PROGRESS_LOG="${TRIGGER_DIR}/progress.log"
PROGRESS_MAX_LINES="${UPDATER_PROGRESS_MAX_LINES:-400}"

COMPOSE_FILE="${UPDATER_COMPOSE_FILE:-/afct/docker-compose.yml}"
ENV_FILE="${UPDATER_ENV_FILE:-/afct/.env.production}"
MANIFEST_FILE="${UPDATER_MANIFEST_FILE:-/afct/versions.json}"
# The curated release manifest, fetched over HTTPS so a deployed host learns about
# new releases without redeploying versions.json. This is the authoritative allow
# list (independent of the app, which only requests a tag). MANIFEST_FILE above is
# the fallback when the remote is unreachable. Set empty to disable the remote fetch
# (the test harness does this to stay offline and deterministic).
MANIFEST_URL="${UPDATER_MANIFEST_URL:-https://raw.githubusercontent.com/PennStateCS/AFCT/main/deploy/versions.json}"
# Base for fetching a release's compose file, so an upgrade whose release changed the
# stack layout (a new service, a healthcheck) can apply it without a host-side
# `install.sh self-update`. The file is fetched from the immutable RELEASE TAG ref
# (<base>/<tag>/deploy/docker-compose.yml), validated, backed up, and only written when
# it differs. Uses `-` (not `:-`) so an explicitly-empty value disables it -- the test
# harness sets it empty to stay offline; a deployment can set it empty as a kill switch.
COMPOSE_BASE_URL="${UPDATER_COMPOSE_BASE_URL-https://raw.githubusercontent.com/PennStateCS/AFCT}"
COMPOSE_PATH_IN_REPO="${UPDATER_COMPOSE_PATH_IN_REPO:-deploy/docker-compose.yml}"

APP_SERVICE="${AFCT_APP_SERVICE:-app}"
APP_CONTAINER="${AFCT_APP_CONTAINER:-afct-app}"
# Sidecars versioned in lockstep with the app; recreated together on an upgrade.
# Postgres (digest-pinned) and this updater are deliberately excluded — the updater
# cannot recreate its own container mid-run, so its new image is picked up by the
# next host-side `docker compose pull`.
NGINX_SERVICE="${AFCT_NGINX_SERVICE:-nginx}"
BACKUP_SERVICE="${AFCT_BACKUP_SERVICE:-db-backup}"
# The evaluator worker runs the SAME app image (same tag), so it must be pulled and
# recreated together with the app on every upgrade/downgrade; otherwise it lags on the
# old image across a schema migration.
WORKER_SERVICE="${AFCT_WORKER_SERVICE:-worker}"
STACK_SERVICES="${AFCT_STACK_SERVICES:-$APP_SERVICE $NGINX_SERVICE $BACKUP_SERVICE $WORKER_SERVICE}"
# This updater's own compose service. Recreated only by an explicit `self-update`
# action, handed off to a detached helper (it can't recreate its own container).
UPDATER_SERVICE="${AFCT_UPDATER_SERVICE:-updater}"
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
# Live progress log. Raw command output (docker pull / compose up) and periodic
# heartbeat notes are appended here so the UI can stream what's happening; the
# coarse phase still lives in status.json. Trimmed to the last PROGRESS_MAX_LINES
# so a verbose or slow pull can't grow it without bound.
# --------------------------------------------------------------------------- #
progress_reset() {
  : > "$PROGRESS_LOG" 2>/dev/null || true
}

progress_note() {
  # One timestamped milestone/heartbeat line, e.g. "still downloading (30s)".
  _pnow=$(date -u '+%H:%M:%S' 2>/dev/null || printf '')
  printf '%s %s\n' "$_pnow" "${1:-}" >> "$PROGRESS_LOG" 2>/dev/null || true
}

progress_trim() {
  [ -f "$PROGRESS_LOG" ] || return 0
  _plines=$(wc -l < "$PROGRESS_LOG" 2>/dev/null || printf '0')
  if [ "${_plines:-0}" -gt "$PROGRESS_MAX_LINES" ] 2>/dev/null; then
    _ptmp="${PROGRESS_LOG}.trim.$$"
    tail -n "$PROGRESS_MAX_LINES" "$PROGRESS_LOG" > "$_ptmp" 2>/dev/null &&
      mv "$_ptmp" "$PROGRESS_LOG" 2>/dev/null || rm -f "$_ptmp" 2>/dev/null || true
  fi
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

dc_file() {
  # Like dc(), but against an arbitrary compose file (used to validate a candidate
  # release compose before it is installed).
  _f=$1
  _proj=$2
  shift 2
  docker compose -p "$_proj" --env-file "$ENV_FILE" -f "$_f" "$@"
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

# Set by apply_release_compose so the upgrade flow can restore the previous compose
# file if it has to roll back. Empty means the compose was not changed this run.
_COMPOSE_BACKUP=""

# When a release changes the stack layout (adds a service, a healthcheck, a volume),
# the running compose file on the host is stale and recreating from it would miss the
# change. This fetches the target release's compose from its IMMUTABLE TAG ref, and if
# it differs from what's on disk, validates it and swaps it in (keeping a backup).
#
# Safety rails, because this rewrites the file that defines the whole stack:
#   - source is the signed release tag ref only (never a branch), same repo as the app
#   - the fetched file must pass `docker compose config` before it is trusted
#   - the current file is backed up first, so the upgrade's rollback path can restore it
#   - best-effort: any failure (offline, bad file) leaves the current compose in place
#     and returns 0. A genuinely required layout change then surfaces as a failed
#     health check and a normal rollback, not a half-applied stack.
# Sets _COMPOSE_BACKUP to the backup path when it swaps the file; leaves it empty
# otherwise. Always returns 0 (never blocks an upgrade on its own).
apply_release_compose() {
  _tag=$1
  _proj=$2
  _COMPOSE_BACKUP=""

  # Disabled (empty base URL): the test harness and any pinned/offline deployment.
  [ -n "$COMPOSE_BASE_URL" ] || return 0

  _url="${COMPOSE_BASE_URL}/${_tag}/${COMPOSE_PATH_IN_REPO}"
  _new="${COMPOSE_FILE}.rel.$$"
  if ! curl -fsS --max-time 20 "$_url" -o "$_new" 2>/dev/null || [ ! -s "$_new" ]; then
    rm -f "$_new"
    progress_note "using the current stack configuration (release compose not fetched)"
    return 0
  fi

  # Identical to what's running: nothing to do, and no backup/notice needed.
  if cmp -s "$_new" "$COMPOSE_FILE"; then
    rm -f "$_new"
    return 0
  fi

  # Validate the candidate before trusting it. `config -q` resolves ${VAR}
  # interpolation against the same env file the stack uses, so it also catches a
  # compose that references variables this host doesn't set.
  if ! dc_file "$_new" "$_proj" config -q >/dev/null 2>&1; then
    rm -f "$_new"
    log "release ${_tag} compose failed validation; keeping the current stack configuration"
    progress_note "release stack configuration failed validation; keeping the current one"
    return 0
  fi

  # Back up the current file (ownership preserved) so rollback can restore it, then
  # swap atomically within the same directory.
  _bak="${COMPOSE_FILE}.bak.${_tag}.$$"
  if ! cp -p "$COMPOSE_FILE" "$_bak" 2>/dev/null; then
    rm -f "$_new"
    log "could not back up the current compose file; keeping it and skipping the release compose"
    return 0
  fi
  _owner=$(stat -c '%u:%g' "$COMPOSE_FILE" 2>/dev/null || true)
  chmod 644 "$_new" 2>/dev/null || true
  [ -n "$_owner" ] && chown "$_owner" "$_new" 2>/dev/null || true
  if ! mv "$_new" "$COMPOSE_FILE"; then
    rm -f "$_new" "$_bak"
    log "could not install the release compose file; keeping the current one"
    return 0
  fi

  _COMPOSE_BACKUP="$_bak"
  log "applied release ${_tag} stack configuration (backup at ${_bak})"
  progress_note "updated the stack configuration for ${_tag}"
  return 0
}

# Restore the compose file backed up by apply_release_compose, used on the rollback
# path so a failed upgrade also reverts a stack-layout change. No-op if nothing was
# changed this run.
restore_release_compose() {
  [ -n "$_COMPOSE_BACKUP" ] || return 0
  if cp -p "$_COMPOSE_BACKUP" "$COMPOSE_FILE" 2>/dev/null; then
    log "restored the previous stack configuration from ${_COMPOSE_BACKUP}"
    progress_note "restored the previous stack configuration"
  else
    log "WARNING: could not restore the previous compose file from ${_COMPOSE_BACKUP}"
  fi
}

# Disk needed before a pull is attempted, in MB. The dashboard image is ~4.7GB and
# Docker needs room for the compressed download AND the unpacked layers at once, so
# the default leaves real headroom. Checked up-front because the failure mode
# otherwise is ugly: the pull dies half-way with "no space left on device", the
# upgrade rolls back, and the log says only "failed" -- which is what happened on
# the first deployment to fill its disk.
DISK_MIN_MB="${UPDATER_DISK_MIN_MB:-12000}"

# Free MB on the filesystem that backs Docker's image store. Prefer the data root
# when it's visible; otherwise this container's own / , which is itself carved out
# of that same filesystem. Echoes nothing if it can't be determined, in which case
# the caller proceeds rather than blocking an upgrade on a failed check.
#
# The path is chosen with a -d test rather than by chaining `df ... || df ...`:
# piping a failed df into awk still exits 0, so the fallback would never run and
# this would quietly always return empty.
free_disk_mb() {
  _df_path=/var/lib/docker
  [ -d "$_df_path" ] || _df_path=/
  df -Pm "$_df_path" 2>/dev/null | awk 'NR==2 {print $4}'
}

# Delete our images other than the two tags worth keeping: the one now running and
# the one to roll back to. Without this every upgrade leaves its predecessor behind
# forever -- eight releases of a 4.7GB image is enough to fill a 38GB disk, which is
# exactly how this got found. Untagged leftovers go too. Never touches postgres
# (digest-pinned) or the updater's own image, and failures here are logged but never
# fail the upgrade: the new version is already up and healthy by this point.
prune_old_images() {
  _keep_a=$1
  _keep_b=$2
  _repo_prefix="${IMAGE_REPO%/*}"   # e.g. ghcr.io/pennstatecs

  docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null |
    grep "^${_repo_prefix}/afct-" |
    while IFS= read -r _img; do
      _img_tag="${_img##*:}"
      [ "$_img_tag" = "$_keep_a" ] && continue
      [ "$_img_tag" = "$_keep_b" ] && continue
      docker rmi "$_img" >/dev/null 2>&1 || true
    done

  # Dangling layers left behind by the retagged/removed images.
  docker image prune -f >/dev/null 2>&1 || true

  _free=$(free_disk_mb)
  [ -n "$_free" ] && log "image cleanup done (${_free}MB free, keeping ${_keep_a} and ${_keep_b})"
}

recreate_app() {
  _proj=$1
  # Pull + recreate the app and its lockstep sidecars (nginx, backup) at the selected
  # tag. Word-splitting of STACK_SERVICES is intentional (a list of service names).
  # Run the pull in the background and keep the heartbeat alive while it runs: a large
  # image over a slow link can take longer than the healthcheck's staleness window,
  # which would mark this sidecar unhealthy and flip the app's "updater available"
  # flag to false in the middle of an upgrade.
  progress_note "pulling images (${STACK_SERVICES})"
  # shellcheck disable=SC2086
  dc "$_proj" pull $STACK_SERVICES >> "$PROGRESS_LOG" 2>&1 &
  _pull_pid=$!
  _elapsed=0
  while kill -0 "$_pull_pid" 2>/dev/null; do
    beat
    sleep "$HEALTH_INTERVAL"
    _elapsed=$((_elapsed + HEALTH_INTERVAL))
    progress_note "still downloading (${_elapsed}s elapsed)"
    progress_trim
  done
  wait "$_pull_pid" || { progress_note "image pull failed"; return 1; }
  progress_note "images ready; recreating containers"
  # shellcheck disable=SC2086
  dc "$_proj" up -d $STACK_SERVICES >> "$PROGRESS_LOG" 2>&1 || { progress_note "recreate failed"; return 1; }
  progress_trim
  progress_note "containers recreated"
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
        # `unhealthy` (and `starting`, which matches no case and falls through) are both
        # transient during a cold first boot: a heavy app running DB migrations can fail
        # its early healthchecks and briefly flip to `unhealthy` before it finishes, then
        # recover. Keep polling within the HEALTH_TIMEOUT budget instead of rolling back
        # on the first bad read -- that first-read rollback caused spurious rollbacks on
        # slow or disk-pressured hosts (a still-unhealthy app is still rolled back once the
        # budget runs out below). A crashed container (exited/dead) cannot recover, so it
        # still fails fast.
        running\|unhealthy) ;;
        # No healthcheck on the image: "running" is the only signal we have, so accept
        # it rather than looping to a timeout (which would roll back every upgrade). A
        # stack that wants rollback-on-boot-failure must define a container healthcheck.
        running\|none) return 0 ;;
        exited\|*|dead\|*) return 1 ;;
      esac
    fi
    sleep "$HEALTH_INTERVAL"
    _elapsed=$((_elapsed + HEALTH_INTERVAL))
  done
  return 1
}

# Newest completed backup the sidecar has produced, or nothing. Matches the current
# bundle format (afct-<ts>.tar.gz, or .tar.gz.gpg when encrypted) AND the legacy
# DB-only dump, newest first. The unexpanded globs for formats that don't exist are
# harmlessly skipped (their errors go to /dev/null). ".partial-" temp files and the
# legacy "afct-files-" companion never match these globs, so they can't be mistaken
# for a completed backup.
latest_backup() {
  ls -1t "$BACKUP_DIR"/afct-*.tar.gz "$BACKUP_DIR"/afct-*.tar.gz.gpg "$BACKUP_DIR"/afct-*.dump \
    2>/dev/null | head -n 1
}

# Strip the afct- prefix and the known suffix off a backup filename, leaving the
# timestamp used as the restore-point key (and by the sidecar to locate it on restore).
backup_timestamp() {
  basename "$1" | sed -e 's/^afct-//' -e 's/\.tar\.gz\.gpg$//' -e 's/\.tar\.gz$//' -e 's/\.dump$//'
}

# Ask the existing backup sidecar for a fresh backup and wait for a new archive to
# appear. On success, echoes the new backup's timestamp (so the caller can record a
# restore point). Best-effort: the image rollback still protects an upgrade.
backup_and_wait() {
  _before=$(latest_backup)
  mkdir -p "$BACKUP_TRIGGER_DIR" 2>/dev/null || return 1
  : > "$BACKUP_TRIGGER_FILE" 2>/dev/null || return 1
  # Note progress to the streamed log (a file, so this never pollutes the timestamp
  # this function echoes on success). Without these, the backup phase is silent and
  # looks stalled, and it can genuinely be the longest step on a large database.
  progress_note "backing up the database"
  _elapsed=0
  while [ "$_elapsed" -lt "$BACKUP_TIMEOUT" ]; do
    beat
    _now=$(latest_backup)
    if [ -n "$_now" ] && [ "$_now" != "$_before" ]; then
      progress_note "database backup complete (${_elapsed}s)"
      backup_timestamp "$_now"
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
    _elapsed=$((_elapsed + HEALTH_INTERVAL))
    progress_note "still backing up the database (${_elapsed}s elapsed)"
    progress_trim
  done
  progress_note "database backup did not complete within ${BACKUP_TIMEOUT}s"
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

# Delete a restore point the admin no longer wants: drop it from the map and delete its
# backup artifacts (reclaiming disk). Only a RECORDED restore point can be deleted, so
# the app can never make this remove an arbitrary file. Does NOT write an upgrade phase
# to status.json (this isn't an upgrade); the app refetches the list to see it gone.
process_delete_restore_point() {
  _rp=$1
  _rid=$2
  # Same shape as a downgrade target: digits and dashes only (YYYYMMDD-HHMMSS).
  case "$_rp" in
    '' | *[!0-9-]*)
      log "delete restore point rejected: invalid timestamp"
      return 0
      ;;
  esac
  if ! { [ -f "$RESTORE_POINTS_FILE" ] && jq -e --arg b "$_rp" \
       'any(.[]?; .backup == $b)' "$RESTORE_POINTS_FILE" >/dev/null 2>&1; }; then
    log "delete restore point ${_rp}: not a recorded restore point; ignoring"
    return 0
  fi

  log "deleting restore point ${_rp} (request ${_rid})"
  # 1) Remove the entry (or entries) from the map so the app stops offering it.
  _tmp="${RESTORE_POINTS_FILE}.tmp.$$"
  if jq --arg b "$_rp" 'map(select(.backup != $b))' "$RESTORE_POINTS_FILE" > "$_tmp" 2>/dev/null; then
    mv "$_tmp" "$RESTORE_POINTS_FILE" 2>/dev/null || rm -f "$_tmp"
  else
    rm -f "$_tmp"
  fi
  # 2) Delete the backup artifacts for this timestamp: the current bundle
  # (.tar.gz / .tar.gz.gpg) and the legacy DB dump + files companion.
  rm -f "$BACKUP_DIR/afct-${_rp}.tar.gz" \
        "$BACKUP_DIR/afct-${_rp}.tar.gz.gpg" \
        "$BACKUP_DIR/afct-${_rp}.dump" \
        "$BACKUP_DIR/afct-files-${_rp}.tgz" 2>/dev/null || true
  log "deleted restore point ${_rp}"
  return 0
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
    upgrade | downgrade | self-update | delete-restore-point) : ;;
    *)
      write_status "failed" "unsupported action: ${_action}" "" "" "$_rid"
      rm -f "$CLAIM_FILE"
      return 0
      ;;
  esac

  # Deleting a restore point needs no tag or running container; handle it before those
  # checks (it removes an old backup the admin no longer wants to keep).
  if [ "$_action" = "delete-restore-point" ]; then
    process_delete_restore_point "$_restore_point" "$_rid"
    rm -f "$CLAIM_FILE"
    return 0
  fi

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

  if [ "$_action" = "self-update" ]; then
    # Clear the claim BEFORE the swap: the recreate helper replaces this container, and
    # the new updater must not find a stale claim and reprocess it.
    process_self_update "$_tag" "$_rid" "$_from" "$_proj"
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
  # Fresh live log for this upgrade; the UI streams it from the first phase on.
  progress_reset
  progress_note "starting upgrade ${_from} -> ${_tag}"

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

  # Refuse to start when there clearly isn't room, instead of failing mid-download
  # and rolling back. Nothing has changed yet at this point, so the running version
  # is untouched and the admin gets an actionable message.
  _free=$(free_disk_mb)
  if [ -n "$_free" ] && [ "$_free" -lt "$DISK_MIN_MB" ]; then
    log "upgrade to ${_tag} refused: only ${_free}MB free, need ${DISK_MIN_MB}MB"
    write_status "failed" \
      "Not enough disk space: ${_free}MB free, ${DISK_MIN_MB}MB required. Free space on the server (docker image prune -af) and try again." \
      "$_from" "$_tag" "$_rid"
    rm -f "$CLAIM_FILE"
    return 0
  fi

  write_status "pulling" "downloading ${IMAGE_REPO}:${_tag}" "$_from" "$_tag" "$_rid"
  if ! set_app_tag "$_tag"; then
    write_status "failed" "could not update the version in the environment file" "$_from" "$_tag" "$_rid"
    rm -f "$CLAIM_FILE"
    return 0
  fi

  # If this release changed the stack layout, pull its compose in before recreating,
  # so a new service or healthcheck is applied as part of the same upgrade. Best
  # effort and self-reverting: the rollback path below restores the old file.
  apply_release_compose "$_tag" "$_proj"

  if recreate_app "$_proj"; then
    write_status "migrating" "waiting for ${_tag} to become healthy" "$_from" "$_tag" "$_rid"
    if wait_for_health "$_proj"; then
      write_status "healthy" "upgraded to ${_tag}" "$_from" "$_tag" "$_rid"
      log "upgrade to ${_tag} complete"
      # Only once the new version is up and healthy: keep it and the rollback
      # target, drop everything older.
      prune_old_images "$_tag" "$_from"
      # The new compose is proven good; drop its backup so they don't pile up.
      [ -n "$_COMPOSE_BACKUP" ] && rm -f "$_COMPOSE_BACKUP"
      rm -f "$CLAIM_FILE"
      return 0
    fi
  fi

  # Roll back to the previous tag.
  write_status "rolling_back" "the upgrade failed; restoring ${_from}" "$_from" "$_tag" "$_rid"
  log "upgrade to ${_tag} failed; rolling back to ${_from}"
  # Revert the compose file too if this upgrade swapped it, so the rollback recreates
  # the old stack shape and not the new one that just failed.
  restore_release_compose
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
# Self-update: recreate THIS updater container at a new tag.
#
# The updater image tracks AFCT_APP_TAG, so after an app upgrade this container is a
# version behind. A process can't recreate the container it runs in, so we pull the
# new updater image and hand off to a short-lived, detached helper that swaps the
# container a moment later (recreate_updater). Best-effort by design: we report
# healthy BEFORE the swap, so if the helper fails the old updater simply keeps running
# (exactly today's behaviour) instead of leaving the box without an updater.
# --------------------------------------------------------------------------- #
this_container_id() {
  # Docker sets the container's hostname to its id unless overridden (we don't).
  cat /etc/hostname 2>/dev/null | tr -d '[:space:]'
}

# Write this updater's version to the shared volume, so the app can tell when the
# updater is behind and offer a self-update. Prefer the image's version label, but the
# updater image doesn't currently carry one, so fall back to the tag in its image ref
# (e.g. ghcr.io/pennstatecs/afct-updater:v0.1.12 -> v0.1.12). Best-effort.
stamp_updater_version() {
  _self=$(this_container_id)
  [ -n "$_self" ] || return 0
  _ver=$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$_self" 2>/dev/null || printf '')
  if [ -z "$_ver" ]; then
    _img=$(docker inspect --format '{{.Config.Image}}' "$_self" 2>/dev/null || printf '')
    case "$_img" in
      *@*) : ;;              # digest-pinned ref: no readable tag, leave unset
      *:*) _ver=${_img##*:} ;; # strip repo, keep the tag after the last colon
    esac
  fi
  [ -n "$_ver" ] && printf '%s\n' "$_ver" > "${TRIGGER_DIR}/updater.version" 2>/dev/null || true
}

recreate_updater() {
  _proj=$1
  _self=$(this_container_id)
  [ -n "$_self" ] || { progress_note "could not determine the updater container"; return 1; }
  # The helper runs the updater's OWN image (it has docker + compose); the new image
  # is picked up by its `up -d`. `docker run -v` needs HOST paths, so resolve the host
  # source backing this container's /afct mount.
  _self_image=$(docker inspect --format '{{.Config.Image}}' "$_self" 2>/dev/null || printf '')
  [ -n "$_self_image" ] || { progress_note "could not resolve the updater image"; return 1; }
  _afct_src=$(docker inspect \
    --format '{{ range .Mounts }}{{ if eq .Destination "/afct" }}{{ .Source }}{{ end }}{{ end }}' \
    "$_self" 2>/dev/null || printf '')
  [ -n "$_afct_src" ] || { progress_note "could not resolve the deploy directory"; return 1; }

  # Sleep briefly so the caller can finish writing status before this container is
  # replaced; then recreate only the updater (no deps) at the already-pulled image.
  _cmd="sleep 3; docker compose -p '${_proj}' --env-file '${ENV_FILE}' -f '${COMPOSE_FILE}' --profile updater up -d --no-deps ${UPDATER_SERVICE}"
  docker run -d --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "${_afct_src}:/afct" \
    "$_self_image" sh -c "$_cmd" >/dev/null 2>&1 || {
    progress_note "could not start the update-service swap helper"
    return 1
  }
  return 0
}

process_self_update() {
  _tag=$1
  _rid=$2
  _from=$3
  _proj=$4

  if ! tag_allowed "$_tag"; then
    write_status "failed" "version is not an allowed release" "$_from" "$_tag" "$_rid"
    return 0
  fi

  progress_reset
  progress_note "updating the update service to ${_tag}"
  write_status "self_updating" "updating the update service to ${_tag}" "$_from" "$_tag" "$_rid"

  # Pull the new updater image first so the swap is quick and can't fail on the network.
  if ! dc "$_proj" --profile updater pull "$UPDATER_SERVICE" >> "$PROGRESS_LOG" 2>&1; then
    progress_note "could not download the update service ${_tag}"
    write_status "failed" "could not download the update service ${_tag}" "$_from" "$_tag" "$_rid"
    return 0
  fi

  # Report success up front: once the helper replaces this container we can no longer
  # write status, and a failed swap is non-fatal (the old updater keeps running).
  if recreate_updater "$_proj"; then
    progress_note "update service ${_tag} downloaded; swapping in the background"
    write_status "healthy" "update service updated to ${_tag}" "$_from" "$_tag" "$_rid"
  else
    write_status "failed" "could not restart the update service" "$_from" "$_tag" "$_rid"
  fi
  return 0
}

# --------------------------------------------------------------------------- #
# Main loop
# --------------------------------------------------------------------------- #
log "AFCT updater started (watching ${TRIGGER_DIR})"
stamp_updater_version
beat

# Recover a claim left behind by a crash mid-upgrade: retry it once. But if a newer
# request already arrived, it supersedes the interrupted one — discard the stale claim
# rather than clobbering the pending request.
if [ -f "$CLAIM_FILE" ]; then
  if [ -f "$REQUEST_FILE" ]; then
    rm -f "$CLAIM_FILE" 2>/dev/null || true
  else
    mv "$CLAIM_FILE" "$REQUEST_FILE" 2>/dev/null || true
  fi
fi

while :; do
  beat
  if [ -f "$REQUEST_FILE" ]; then
    process_request || log "request processing raised an unexpected error"
  fi
  [ "$ONCE" = "true" ] && break
  sleep "$POLL_INTERVAL"
done
