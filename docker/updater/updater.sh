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
# the fallback when the remote is unreachable. Uses `-` (not `:-`) so an explicitly-empty
# value disables the remote fetch (the test harness does this to stay offline and
# deterministic); an unset value still gets the default.
MANIFEST_URL="${UPDATER_MANIFEST_URL-https://raw.githubusercontent.com/PennStateCS/AFCT/main/deploy/versions.json}"
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
# Records an in-flight self-update (target tag + request id) written by the OLD updater
# just before it hands off the container swap. The NEW updater reads it on startup and
# only THEN writes the final "healthy" status, once it confirms it is actually running
# the target version. Without this handshake a self-update reports success before the
# swap is verified.
SELF_UPDATE_PENDING_FILE="${TRIGGER_DIR}/.self-update-pending.json"
UPDATER_VERSION_FILE="${TRIGGER_DIR}/updater.version"
# Whether this updater can actually see the two files it has to rewrite to perform an
# upgrade. Stamped every poll, read by the app. A container left running across a compose
# change keeps whatever paths it started with, so it can be the right VERSION and still be
# unable to do the job; without this the Updates tab called that "up to date" and every
# upgrade failed late with an error the operator could not act on.
UPDATER_READINESS_FILE="${TRIGGER_DIR}/updater.readiness.json"

# What the server itself needs, as opposed to what AFCT needs: a pending restart, waiting
# security updates, a clock that has drifted. The app container deliberately cannot see any
# of this (it grades untrusted submissions, so it gets no host mounts), but this container
# already drives the Docker socket, so it is the one place the facts are reachable. Written
# every poll beside the files above and read by Admin -> System Status.
HOST_FACTS_FILE="${TRIGGER_DIR}/host.json"
# Where the host's own directories are mounted, read-only. Overridden by the tests.
HOST_ROOT="${UPDATER_HOST_ROOT:-/host}"

HEALTH_TIMEOUT="${UPDATER_HEALTH_TIMEOUT:-300}"
HEALTH_INTERVAL="${UPDATER_HEALTH_INTERVAL:-5}"
BACKUP_TIMEOUT="${UPDATER_BACKUP_TIMEOUT:-600}"
RESTORE_TIMEOUT="${UPDATER_RESTORE_TIMEOUT:-600}"
POLL_INTERVAL="${UPDATER_POLL_INTERVAL:-5}"
HOST_FACTS_INTERVAL="${UPDATER_HOST_FACTS_INTERVAL:-300}"
REQUIRE_BACKUP="${UPDATER_REQUIRE_BACKUP:-false}"
ONCE="${UPDATER_ONCE:-false}"

# After the stack is recreated and every required service is healthy, watch it for this
# long before committing the upgrade, to catch a service that comes up and then
# crash-loops. Set to 0 to skip the stability window (the test harness does).
STABILITY_SECONDS="${UPDATER_STABILITY_SECONDS:-45}"
# Bounded retries with backoff for the operations that are SAFE to retry: image pulls
# and remote GETs (release manifest, release compose). Never applied to database
# restores, migrations, container recreation, or the env-file rewrite. 1 = a single
# attempt (no retry); the test harness sets 1 so it doesn't wait out backoffs.
PULL_RETRIES="${UPDATER_PULL_RETRIES:-3}"
PULL_RETRY_DELAY="${UPDATER_PULL_RETRY_DELAY:-10}"
FETCH_RETRIES="${UPDATER_FETCH_RETRIES:-3}"
FETCH_RETRY_DELAY="${UPDATER_FETCH_RETRY_DELAY:-5}"
# When true, a recreated service that defines NO container healthcheck fails
# verification instead of passing on "running". Off by default because the worker is a
# background process with no healthcheck by design; a deployment that healthchecks every
# service can turn this on for a stricter gate.
REQUIRE_HEALTHCHECKS="${UPDATER_REQUIRE_HEALTHCHECKS:-false}"
# How many lines of a failing service's output to copy into the progress log before the
# rollback destroys the container that produced them. Enough to carry a stack trace, small
# enough not to push the rest of the upgrade out of a size-capped log.
DEGRADED_LOG_LINES="${UPDATER_DEGRADED_LOG_LINES:-25}"

# Fail closed on the release allowlist: when NO manifest can be consulted (the remote is
# unreachable AND there is no readable local versions.json), refuse the tag instead of
# trusting the character allowlist alone. A dev or deliberately-offline deployment that
# accepts any character-safe tag can opt back into the old behaviour by setting this true.
ALLOW_UNVERIFIED_TAGS="${UPDATER_ALLOW_UNVERIFIED_TAGS:-false}"
# Upper bound on the request file the app drops in the shared volume. A real request is a
# few hundred bytes; anything larger is rejected before jq sees it, so a truncated, garbage,
# or hostile file can't be parsed or blow up memory.
REQUEST_MAX_BYTES="${UPDATER_REQUEST_MAX_BYTES:-65536}"

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
# Update transaction: durable, recoverable state for an in-flight upgrade.
#
# status.json tells the UI the coarse phase; it is not enough to RECOVER from. If this
# container (or the host) restarts mid-upgrade, the next start must know how far the
# previous run got and what the prior-good state was, or it can wrongly trust the env
# file and report a half-applied version as healthy. This file records that: the
# previous tag, the LOCAL image ids to roll back to (so rollback never needs the
# registry), whether the env or compose files were changed, and the current phase.
# Written atomically. Lives in the shared trigger volume so it survives a container swap.
#
# These transaction phases are INTERNAL and finer-grained than the status.json phases
# the UI consumes; the two are deliberately separate so the UI contract does not change.
# Phases: requested, backing_up, validating, pulling, compose_updated, recreating,
# verifying, committed, rolling_back, rolled_back, failed.
# --------------------------------------------------------------------------- #
TXN_FILE="${TRIGGER_DIR}/transaction.json"
TXN_SCHEMA="afct-update-txn/v1"

# In-memory mirror of the transaction, re-serialized in full on each change so every
# write is atomic and the file is never observed as a partial object.
_TXN_ACTIVE=0
_TXN_ACTION=""
_TXN_PHASE=""
_TXN_START_PHASE=""
_TXN_FROM=""
_TXN_TO=""
_TXN_PROJECT=""
_TXN_RID=""
_TXN_IMAGES='{}'          # {service: local-image-id} captured before any change
_TXN_ENV_CHANGED=false
_TXN_COMPOSE_REPLACED=false
_TXN_COMPOSE_BACKUP=""
_TXN_BACKUP_TS=""
_TXN_RESTORE_POINT=""
_TXN_STARTED_AT=""
_TXN_ROLLBACK_REQUIRED=false
_TXN_COMMITTED=false

_now_iso() { date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf 'unknown'; }

txn_save() {
  [ "$_TXN_ACTIVE" = "1" ] || return 0
  _txn_tmp="${TXN_FILE}.tmp.$$"
  if jq -n \
    --arg schema "$TXN_SCHEMA" \
    --arg requestId "$_TXN_RID" \
    --arg action "$_TXN_ACTION" \
    --arg phase "$_TXN_PHASE" \
    --arg startPhase "$_TXN_START_PHASE" \
    --arg fromTag "$_TXN_FROM" \
    --arg toTag "$_TXN_TO" \
    --arg project "$_TXN_PROJECT" \
    --argjson images "$_TXN_IMAGES" \
    --argjson envChanged "$_TXN_ENV_CHANGED" \
    --argjson composeReplaced "$_TXN_COMPOSE_REPLACED" \
    --arg composeBackup "$_TXN_COMPOSE_BACKUP" \
    --arg backupTimestamp "$_TXN_BACKUP_TS" \
    --arg restorePoint "$_TXN_RESTORE_POINT" \
    --arg startedAt "$_TXN_STARTED_AT" \
    --arg updatedAt "$(_now_iso)" \
    --argjson rollbackRequired "$_TXN_ROLLBACK_REQUIRED" \
    --argjson committed "$_TXN_COMMITTED" \
    '{schema:$schema, requestId:$requestId, action:$action, phase:$phase,
      startPhase:$startPhase, fromTag:$fromTag, toTag:$toTag, project:$project,
      images:$images, envChanged:$envChanged, composeReplaced:$composeReplaced,
      composeBackup:$composeBackup, backupTimestamp:$backupTimestamp,
      restorePoint:$restorePoint, startedAt:$startedAt, updatedAt:$updatedAt,
      rollbackRequired:$rollbackRequired, committed:$committed}' \
    > "$_txn_tmp" 2>/dev/null && mv "$_txn_tmp" "$TXN_FILE" 2>/dev/null; then
    return 0
  fi
  rm -f "$_txn_tmp" 2>/dev/null || true
  log "could not write the transaction file"
}

txn_begin() {
  _TXN_ACTIVE=1
  _TXN_ACTION=$1
  _TXN_FROM=$2
  _TXN_TO=$3
  _TXN_PROJECT=$4
  _TXN_RID=$5
  _TXN_PHASE="requested"
  _TXN_START_PHASE="requested"
  _TXN_IMAGES='{}'
  _TXN_ENV_CHANGED=false
  _TXN_COMPOSE_REPLACED=false
  _TXN_COMPOSE_BACKUP=""
  _TXN_BACKUP_TS=""
  _TXN_RESTORE_POINT=""
  _TXN_STARTED_AT=$(_now_iso)
  _TXN_ROLLBACK_REQUIRED=false
  _TXN_COMMITTED=false
  txn_save
}

txn_phase() { _TXN_PHASE=$1; txn_save; }

# Remove the transaction file and mark the in-memory transaction inactive. Called once
# a run has reached a terminal outcome (committed, rolled_back, or a failed recovery),
# so a later start does not re-run it.
txn_clear() {
  _TXN_ACTIVE=0
  rm -f "$TXN_FILE" 2>/dev/null || true
}

# --------------------------------------------------------------------------- #
# Image identity: capture the LOCAL image each service runs before anything changes,
# so a rollback can reuse those exact images without contacting the registry.
# --------------------------------------------------------------------------- #

# Echo a JSON object {service: imageId} for the stack services currently running, by
# inspecting each service's container. "{}" if none could be inspected. The image id is
# a local content digest (sha256:...), stable across a tag being moved or deleted.
capture_stack_images() {
  _proj=$1
  _obj='{}'
  # shellcheck disable=SC2086
  for _svc in $STACK_SERVICES; do
    _cid=$(dc "$_proj" ps -q "$_svc" 2>/dev/null | head -n 1)
    [ -n "$_cid" ] || continue
    _iid=$(docker inspect -f '{{.Image}}' "$_cid" 2>/dev/null || true)
    [ -n "$_iid" ] || continue
    _obj=$(printf '%s' "$_obj" | jq -c --arg s "$_svc" --arg i "$_iid" '. + {($s): $i}' 2>/dev/null || printf '%s' "$_obj")
  done
  printf '%s' "$_obj"
}

# The local image id a repo:tag currently resolves to, or empty when the tag is not
# present locally.
tag_image_id() {
  docker image inspect -f '{{.Id}}' "${IMAGE_REPO}:$1" 2>/dev/null
}

# The image id the running app container is on, or empty.
running_app_image_id() {
  _proj=$1
  _cid=$(dc "$_proj" ps -q "$APP_SERVICE" 2>/dev/null | head -n 1)
  [ -n "$_cid" ] || return 1
  docker inspect -f '{{.Image}}' "$_cid" 2>/dev/null
}

# A single health read (not the polling loop). running+healthy or running+none pass;
# anything else (starting, unhealthy, exited) is treated as not-yet-good.
health_ok_once() {
  _proj=$1
  _id=$(dc "$_proj" ps -q "$APP_SERVICE" 2>/dev/null | head -n 1)
  [ -n "$_id" ] || return 1
  _state=$(docker inspect \
    -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    "$_id" 2>/dev/null || printf 'missing|none')
  case "$_state" in
    running\|healthy) return 0 ;;
    running\|none) return 0 ;;
    *) return 1 ;;
  esac
}

# True only when the app container is actually running the given tag's image (compared
# by local image id, never the registry) AND reports healthy right now. This is how a
# request for the version already pinned in .env is CONFIRMED rather than trusted: the
# env file records what was requested, not what is deployed and healthy.
deployed_and_healthy() {
  _tag=$1
  _proj=$2
  _run=$(running_app_image_id "$_proj") || return 1
  _want=$(tag_image_id "$_tag") || return 1
  [ -n "$_run" ] && [ -n "$_want" ] && [ "$_run" = "$_want" ] || return 1
  health_ok_once "$_proj"
}

# If the previous tag's image is missing locally (pruned, or its tag was removed), point
# the tag back at the exact image id captured before the upgrade, so a local-only
# recreate can still resolve it. No-op when the tag already resolves locally.
restore_rollback_image() {
  _from=$1
  tag_image_id "$_from" >/dev/null 2>&1 && return 0
  _iid=$(printf '%s' "$_TXN_IMAGES" | jq -r --arg s "$APP_SERVICE" '.[$s] // ""' 2>/dev/null || printf '')
  [ -n "$_iid" ] || return 1
  docker tag "$_iid" "${IMAGE_REPO}:${_from}" >/dev/null 2>&1 || return 1
  progress_note "restored the ${_from} image from the local cache"
  return 0
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

# Why the last set_app_tag failed, in a form an operator can act on. Empty when it
# worked. The caller puts this in the status message, because "could not update the
# version in the environment file" on its own does not say which file or why, and a
# stale env-file path is exactly the failure this function hits.
SET_APP_TAG_ERROR=""

# Append a KEY=value to the env file if the key is absent, preserving everything else.
#
# Only used for the backup key today, and deliberately narrow: it never replaces a value and
# never touches a line it did not add.
append_env_key() {
  _key=$1
  _val=$2
  _tmp="${ENV_FILE}.updtmp.$$"

  [ -f "$ENV_FILE" ] && [ -r "$ENV_FILE" ] || return 1
  [ -w "$(dirname "$ENV_FILE")" ] || return 1

  _owner=$(stat -c '%u:%g' "$ENV_FILE" 2>/dev/null || true)
  { cat "$ENV_FILE" && printf '%s=%s\n' "$_key" "$_val"; } > "$_tmp" || {
    rm -f "$_tmp"
    return 1
  }
  chmod 600 "$_tmp" 2>/dev/null || true
  [ -n "$_owner" ] && chown "$_owner" "$_tmp" 2>/dev/null || true
  mv "$_tmp" "$ENV_FILE" || { rm -f "$_tmp"; return 1; }
  return 0
}

# Make sure a secret-encryption key exists before the new images come up.
#
# This is the key AFCT encrypts stored settings with: the SMTP password, an OIDC client secret,
# the LTI signing key. Here as well as in the host installer for the same reason as the backup
# key below, and with a sharper symptom: an install that predates the key comes up looking
# perfectly healthy and then refuses the first thing an administrator tries to save, telling
# them to restore a value they were never given. That happened to a real deployment.
#
# Never replaces an existing key, since that would make every already-encrypted secret
# unreadable, which is the one unrecoverable mistake available here. Unlike backups there is no
# opt-out, because nobody deliberately chooses to have no key.
ensure_secret_key() {
  [ -f "$ENV_FILE" ] || return 0
  grep -qE '^AFCT_SECRET_KEY=.' "$ENV_FILE" 2>/dev/null && return 0

  _key=$(head -c 32 /dev/urandom 2>/dev/null | od -An -tx1 2>/dev/null | tr -d ' \n' | cut -c1-48)
  if [ -z "$_key" ]; then
    progress_note "could not generate a secret-encryption key; stored settings such as mail and sign-in credentials cannot be saved until one is set"
    return 1
  fi

  if append_env_key AFCT_SECRET_KEY "$_key"; then
    progress_note "generated a secret-encryption key; it protects stored settings such as mail and sign-in credentials. Keep .env.production with your backups."
  else
    progress_note "could not write a secret-encryption key to the environment file; stored settings cannot be saved until one is set"
    return 1
  fi
  return 0
}


# Make sure a backup-encryption key exists before the new images come up.
#
# This has to happen here as well as in the host installer, because an in-app upgrade never runs
# the installer. From this release the backup service refuses to write an archive without a key
# rather than writing one in the clear, so an upgrade that did not top the key up would stop
# backups silently: the container would come up, log a refusal once a day, and nobody would look
# until they needed a backup that was never taken.
#
# Same two rules as the installer. An existing key is never replaced, because that strands every
# archive already written; an explicit BACKUP_ALLOW_UNENCRYPTED is left alone, because somebody
# who chose plaintext should not have a key appear behind them.
ensure_backup_key() {
  [ -f "$ENV_FILE" ] || return 0
  grep -qE '^BACKUP_ENCRYPTION_KEY=.' "$ENV_FILE" 2>/dev/null && return 0

  if grep -qE '^BACKUP_ALLOW_UNENCRYPTED=(true|TRUE|1|yes)' "$ENV_FILE" 2>/dev/null; then
    progress_note "backups are set to stay unencrypted (BACKUP_ALLOW_UNENCRYPTED); no key generated"
    return 0
  fi

  _key=$(head -c 32 /dev/urandom 2>/dev/null | od -An -tx1 2>/dev/null | tr -d ' \n' | cut -c1-48)
  if [ -z "$_key" ]; then
    progress_note "could not generate a backup-encryption key; backups will not run until one is set"
    return 1
  fi

  if append_env_key BACKUP_ENCRYPTION_KEY "$_key"; then
    progress_note "generated a backup-encryption key; backups are encrypted from now on. Keep .env.production safe: without it an encrypted backup cannot be restored."
  else
    progress_note "could not write a backup-encryption key to the environment file; backups will not run until one is set"
    return 1
  fi
  return 0
}

# Rewrite only the AFCT_APP_TAG line, preserving every other line (and the file's
# secrets). Writes in place so a bind-mounted env file is updated on the host.
set_app_tag() {
  _tag=$1
  _tmp="${ENV_FILE}.updtmp.$$"
  SET_APP_TAG_ERROR=""

  # Check the file first so the message can name the actual problem. Reaching the
  # redirect below with a missing file leaves an empty temp file and returns a bare 1,
  # which is how a mismounted env path looked like an unexplained upgrade failure.
  if [ ! -f "$ENV_FILE" ]; then
    SET_APP_TAG_ERROR="no environment file at ${ENV_FILE} (check the updater's UPDATER_ENV_FILE and its mounts)"
    return 1
  fi
  if [ ! -r "$ENV_FILE" ]; then
    SET_APP_TAG_ERROR="cannot read ${ENV_FILE}"
    return 1
  fi
  if [ ! -w "$(dirname "$ENV_FILE")" ]; then
    SET_APP_TAG_ERROR="cannot write to $(dirname "$ENV_FILE") (read-only mount?)"
    return 1
  fi

  # We run as root but the file belongs to the non-root install user; capture its
  # ownership so we can restore it after the rewrite. Otherwise the file becomes
  # root-owned and the next host-side `install.sh` (run by that user) can't read it.
  _owner=$(stat -c '%u:%g' "$ENV_FILE" 2>/dev/null || true)
  # Every failure below clears the temp file. Leaving it behind used to litter the
  # deploy directory with root-owned empty files, one per failed attempt.
  if grep -qE '^AFCT_APP_TAG=' "$ENV_FILE" 2>/dev/null; then
    awk -v t="$_tag" '/^AFCT_APP_TAG=/ { print "AFCT_APP_TAG=" t; next } { print }' \
      "$ENV_FILE" > "$_tmp" || {
        SET_APP_TAG_ERROR="could not write ${_tmp} (out of disk?)"
        rm -f "$_tmp"
        return 1
      }
  else
    { cat "$ENV_FILE" && printf 'AFCT_APP_TAG=%s\n' "$_tag"; } > "$_tmp" || {
      SET_APP_TAG_ERROR="could not write ${_tmp} (out of disk?)"
      rm -f "$_tmp"
      return 1
    }
  fi
  chmod 600 "$_tmp" 2>/dev/null || true
  [ -n "$_owner" ] && chown "$_owner" "$_tmp" 2>/dev/null || true
  # Same directory as the target, so this rename is atomic and stays on the host
  # filesystem (the deploy directory is bind-mounted, not the single file).
  mv "$_tmp" "$ENV_FILE" || {
    SET_APP_TAG_ERROR="could not replace ${ENV_FILE}"
    rm -f "$_tmp"
    return 1
  }
  return 0
}

# Set by apply_release_compose so the upgrade flow can restore the previous compose
# file if it has to roll back. Empty means the compose was not changed this run.
_COMPOSE_BACKUP=""

# curl with bounded retries + backoff, for idempotent GETs only (the release manifest and
# the release compose file). Passes its args straight through to curl and returns curl's
# exit status from the last attempt. Never use for anything that mutates state.
curl_retry() {
  _cr_attempt=0
  while :; do
    _cr_attempt=$((_cr_attempt + 1))
    if curl "$@"; then return 0; fi
    _cr_rc=$?
    if [ "$_cr_attempt" -ge "$FETCH_RETRIES" ]; then return "$_cr_rc"; fi
    progress_note "network fetch failed (attempt ${_cr_attempt}/${FETCH_RETRIES}); retrying in ${FETCH_RETRY_DELAY}s"
    sleep "$FETCH_RETRY_DELAY"
  done
}

# SHA-256 of a file, first field only, or empty if it can't be computed.
file_sha256() {
  sha256sum "$1" 2>/dev/null | awk '{print $1}'
}

# The expected SHA-256 of a release's compose file, read from the curated manifest
# (remote preferred, local fallback) for the given tag. Empty when the manifest records
# none for that tag (older manifests predate the field), in which case the fetched compose
# is trusted on `docker compose config` validation alone, as before.
release_compose_sha() {
  _rt=$1
  # $t is a jq variable (bound with --arg below), not a shell variable, so it must stay
  # single-quoted and unexpanded.
  # shellcheck disable=SC2016
  _q='((.versions // []) | map(select(.tag == $t)) | .[0].composeSha256) // ""'
  if [ -n "$MANIFEST_URL" ]; then
    _rm=$(curl_retry -fsS --max-time 10 "$MANIFEST_URL" 2>/dev/null || true)
    if [ -n "$_rm" ]; then
      printf '%s' "$_rm" | jq -r --arg t "$_rt" "$_q" 2>/dev/null
      return 0
    fi
  fi
  if [ -f "$MANIFEST_FILE" ] && jq -e . "$MANIFEST_FILE" >/dev/null 2>&1; then
    jq -r --arg t "$_rt" "$_q" "$MANIFEST_FILE" 2>/dev/null
    return 0
  fi
  printf ''
}

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
  if ! curl_retry -fsS --max-time 20 "$_url" -o "$_new" || [ ! -s "$_new" ]; then
    rm -f "$_new"
    progress_note "using the current stack configuration (release compose not fetched)"
    return 0
  fi

  # Identical to what's running: nothing to do, and no backup/notice needed.
  if cmp -s "$_new" "$COMPOSE_FILE"; then
    rm -f "$_new"
    return 0
  fi

  # If the manifest records a checksum for this release's compose, the fetched file must
  # match it before we trust it. This closes the gap where the file is fetched over the
  # network but only self-validated: `docker compose config` proves it PARSES, not that it
  # is the file the release shipped. A mismatch keeps the current stack configuration (a
  # genuinely required layout change then surfaces as a failed health check and a normal
  # rollback). Manifests without the field skip this and fall back to config validation.
  _want_sha=$(release_compose_sha "$_tag")
  if [ -n "$_want_sha" ]; then
    _got_sha=$(file_sha256 "$_new")
    if [ "$_got_sha" != "$_want_sha" ]; then
      rm -f "$_new"
      log "release ${_tag} compose checksum mismatch (expected ${_want_sha}, got ${_got_sha:-none}); keeping the current stack configuration"
      progress_note "release stack configuration failed its checksum; keeping the current one"
      return 0
    fi
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

# Pull the selected tag and recreate the app plus its lockstep sidecars (forward path).
recreate_app() { _recreate_stack "$1" pull; }

# Recreate from LOCAL images only, skipping the registry pull. Used on the rollback
# path: the previous version's images are still on disk (prune runs only after a
# successful upgrade), so a rollback must not depend on the registry, DNS, or the old
# tag still existing remotely.
recreate_app_local() { _recreate_stack "$1" nopull; }

_recreate_stack() {
  _proj=$1
  _mode=$2
  # Word-splitting of STACK_SERVICES is intentional (a list of service names).
  if [ "$_mode" = "pull" ]; then
    # Run the pull in the background and keep the heartbeat alive while it runs: a large
    # image over a slow link can take longer than the healthcheck's staleness window,
    # which would mark this sidecar unhealthy and flip the app's "updater available"
    # flag to false in the middle of an upgrade.
    # `docker compose pull` both downloads and then EXTRACTS the layers. On the ~4.7GB
    # app image the extract alone can take a few minutes, and with --quiet (below) it is
    # silent, so say up front that this whole step can take a while -- otherwise it looks
    # stalled between heartbeats.
    progress_note "downloading and extracting images (this can take a few minutes)"
    # A pull is idempotent and a common transient failure (network blip, registry
    # hiccup), so retry it with backoff, up to PULL_RETRIES attempts. Recreation below is
    # NOT retried here: a partial recreate is handled by the transaction rollback, not a
    # blind re-run.
    _pull_attempt=0
    while :; do
      _pull_attempt=$((_pull_attempt + 1))
      # --quiet: docker redraws per-layer progress bars in place on a TTY, but with output
      # redirected to this file (no TTY) every redraw becomes a NEW line, so the streamed
      # log fills with hundreds of "Downloading [==>]" lines. Suppress that firehose; the
      # elapsed heartbeats below carry liveness, and errors still print to stderr (2>&1).
      # shellcheck disable=SC2086
      dc "$_proj" pull --quiet $STACK_SERVICES >> "$PROGRESS_LOG" 2>&1 &
      _pull_pid=$!
      _elapsed=0
      while kill -0 "$_pull_pid" 2>/dev/null; do
        beat
        sleep "$HEALTH_INTERVAL"
        _elapsed=$((_elapsed + HEALTH_INTERVAL))
        progress_note "still downloading/extracting images (${_elapsed}s elapsed)"
        progress_trim
      done
      if wait "$_pull_pid"; then break; fi
      if [ "$_pull_attempt" -ge "$PULL_RETRIES" ]; then
        progress_note "image pull failed after ${_pull_attempt} attempt(s)"
        return 1
      fi
      progress_note "image pull failed (attempt ${_pull_attempt}/${PULL_RETRIES}); retrying in ${PULL_RETRY_DELAY}s"
      sleep "$PULL_RETRY_DELAY"
    done
    progress_note "images ready; recreating containers"
  else
    progress_note "restoring the previous version from the local image cache"
  fi
  # shellcheck disable=SC2086
  dc "$_proj" up -d $STACK_SERVICES >> "$PROGRESS_LOG" 2>&1 || { progress_note "recreate failed"; return 1; }
  progress_trim
  progress_note "containers recreated"
  return 0
}

# One pass over EVERY recreated stack service. Returns 0 only when all are good; sets
# _STACK_FATAL=true when any container has crashed (exited/dead/gone), which cannot
# recover and should fail the upgrade fast. A service passes on running+healthy, or on
# running+none (no healthcheck defined) unless REQUIRE_HEALTHCHECKS is on. running with
# starting/unhealthy (and restarting/created) is transient: not-ok, but keep polling.
#
# This is stack-wide, not app-only: nginx (whose healthcheck also proves it can reach the
# app), the worker, and the backup sidecar are now verified too, so a crashed sidecar
# fails the upgrade instead of being missed. The worker has no healthcheck by design, so
# it passes on "running".
# How a container's status and health are read.
#
# `index` rather than `{{if .State.Health}}`, because a container that defines no healthcheck has
# no Health key at all in the inspect payload, and looking it up directly is a template ERROR on
# newer Docker CLIs rather than an empty value. This image currently ships an older CLI that
# tolerates it, which is the only reason the dotted form worked: bump the CLI and every
# healthcheck-less container would start reading as `missing`, which this function treats as
# fatal. The worker has no healthcheck by design, so that would fail every upgrade, and before
# the reporting below it would have failed them without saying why.
_STATE_TEMPLATE='{{.State.Status}}|{{if index .State "Health"}}{{index .State "Health" "Status"}}{{else}}none{{end}}'

_STACK_FATAL=false
# Which services were not good on the last call, as "svc=status|health" pairs. Read by the
# callers so a failure names the service instead of only reporting that one exists.
_STACK_BAD=""
stack_state_ok() {
  _proj=$1
  _STACK_FATAL=false
  _STACK_BAD=""
  _ss_ok=true
  # shellcheck disable=SC2086
  for _svc in $STACK_SERVICES; do
    _sid=$(dc "$_proj" ps -q "$_svc" 2>/dev/null | head -n 1)
    if [ -z "$_sid" ]; then
      _ss_ok=false
      _STACK_BAD="$_STACK_BAD $_svc=no-container"
      continue
    fi
    _st=$(docker inspect -f "$_STATE_TEMPLATE" "$_sid" 2>/dev/null || printf 'missing|none')
    case "$_st" in
      running\|healthy) continue ;;
      running\|none)
        # No healthcheck defined. Running is as much as this service can prove.
        [ "$REQUIRE_HEALTHCHECKS" = "true" ] || continue
        _ss_ok=false
        ;;
      exited\|* | dead\|* | missing\|* | removing\|*) _STACK_FATAL=true; _ss_ok=false ;;
      *) _ss_ok=false ;;   # starting, unhealthy, restarting, created: keep polling
    esac
    _STACK_BAD="$_STACK_BAD $_svc=$_st"
  done
  [ "$_ss_ok" = "true" ]
}

# Copy a struggling service's last output into the progress log.
#
# The rollback removes the container that failed, taking its logs with it, so whatever it said
# has to be captured before then or it is gone for good. Without this an administrator (and
# anyone helping them) sees only that an upgrade failed, and diagnosing it means reproducing the
# failure on purpose to watch it happen.
report_degraded() {
  _proj=$1
  # shellcheck disable=SC2086
  for _pair in $_STACK_BAD; do
    _bsvc=${_pair%%=*}
    _bsid=$(dc "$_proj" ps -q "$_bsvc" 2>/dev/null | head -n 1)
    [ -n "$_bsid" ] || continue
    progress_note "last output from ${_bsvc}:"
    docker logs --tail "$DEGRADED_LOG_LINES" "$_bsid" 2>&1 | while IFS= read -r _bline; do
      progress_note "  [${_bsvc}] ${_bline}"
    done
  done
}

# Wait until the whole stack is up and healthy, or HEALTH_TIMEOUT elapses. Fails fast
# when a container crashes.
wait_for_health() {
  _proj=$1
  _elapsed=0
  while [ "$_elapsed" -lt "$HEALTH_TIMEOUT" ]; do
    beat
    if stack_state_ok "$_proj"; then return 0; fi
    if [ "$_STACK_FATAL" = "true" ]; then
      progress_note "a service could not start:${_STACK_BAD}"
      report_degraded "$_proj"
      return 1
    fi
    sleep "$HEALTH_INTERVAL"
    _elapsed=$((_elapsed + HEALTH_INTERVAL))
  done
  progress_note "gave up waiting after ${HEALTH_TIMEOUT}s; still not ready:${_STACK_BAD}"
  report_degraded "$_proj"
  return 1
}

# After the stack is healthy, watch it for STABILITY_SECONDS before committing: a service
# can report healthy and then crash-loop, or the app could restart onto a different image.
# Re-check the whole stack and confirm the app is still on the deployed tag. Returns 0 if
# it stays good for the whole window, 1 if it degrades. Skipped when STABILITY_SECONDS=0.
stabilize_stack() {
  _proj=$1
  _tag=$2
  [ "${STABILITY_SECONDS:-0}" -gt 0 ] 2>/dev/null || return 0
  progress_note "watching for stability for ${STABILITY_SECONDS}s"
  _elapsed=0
  while [ "$_elapsed" -lt "$STABILITY_SECONDS" ]; do
    beat
    if ! stack_state_ok "$_proj"; then
      progress_note "a service degraded during the stability window:${_STACK_BAD}"
      report_degraded "$_proj"
      return 1
    fi
    if ! deployed_and_healthy "$_tag" "$_proj"; then
      progress_note "the app is no longer confirmed on ${_tag} during the stability window"
      return 1
    fi
    sleep "$HEALTH_INTERVAL"
    _elapsed=$((_elapsed + HEALTH_INTERVAL))
    progress_note "stable for ${_elapsed}/${STABILITY_SECONDS}s"
  done
  progress_note "stack stable for ${STABILITY_SECONDS}s"
  return 0
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
  # file. Whichever is consulted decides, allow or deny.
  if [ -n "$MANIFEST_URL" ]; then
    _remote=$(curl_retry -fsS --max-time 10 "$MANIFEST_URL" 2>/dev/null || true)
    if [ -n "$_remote" ]; then
      printf '%s' "$_remote" | jq -e --arg t "$_tag" '(.versions // []) | any(.tag == $t)' >/dev/null 2>&1 || return 1
      return 0
    fi
  fi
  if [ -f "$MANIFEST_FILE" ] && jq -e . "$MANIFEST_FILE" >/dev/null 2>&1; then
    jq -e --arg t "$_tag" '(.versions // []) | any(.tag == $t)' "$MANIFEST_FILE" >/dev/null 2>&1 || return 1
    return 0
  fi
  # No manifest could be consulted: the remote is unreachable and there is no readable
  # local versions.json. Fail closed rather than trusting the character allowlist alone,
  # so a compromised or confused app can't push an unlisted tag. A dev/offline deployment
  # opts back into permissive behaviour with UPDATER_ALLOW_UNVERIFIED_TAGS=true.
  if [ "$ALLOW_UNVERIFIED_TAGS" = "true" ]; then
    log "no release manifest available; allowing ${_tag} (UPDATER_ALLOW_UNVERIFIED_TAGS=true)"
    return 0
  fi
  log "refusing ${_tag}: no release manifest available to verify it against"
  return 1
}

# Roll the stack back to the transaction's previous version, using the LOCAL images
# captured before the upgrade so it never depends on the registry, DNS, or the old tag
# still existing remotely. Restores a swapped compose file too. Reads _TXN_* state, so
# the same path serves both a same-run failure and a recovery after a restart.
rollback_upgrade() {
  write_status "rolling_back" "the upgrade failed; restoring ${_TXN_FROM}" "$_TXN_FROM" "$_TXN_TO" "$_TXN_RID"
  log "rolling back to ${_TXN_FROM}"
  _TXN_ROLLBACK_REQUIRED=true
  txn_phase "rolling_back"

  # If neither the env nor the compose file was changed yet, the running stack was never
  # touched; confirm it is still healthy on the previous version instead of recreating.
  if [ "$_TXN_ENV_CHANGED" != "true" ] && [ "$_TXN_COMPOSE_REPLACED" != "true" ]; then
    if deployed_and_healthy "$_TXN_FROM" "$_TXN_PROJECT"; then
      txn_phase "rolled_back"
      write_status "rolled_back" "restored ${_TXN_FROM} after a failed upgrade to ${_TXN_TO}" "$_TXN_FROM" "$_TXN_TO" "$_TXN_RID"
      return 0
    fi
  fi

  restore_release_compose
  restore_rollback_image "$_TXN_FROM" || log "could not restore the ${_TXN_FROM} image from cache; relying on the tag"
  if set_app_tag "$_TXN_FROM" && recreate_app_local "$_TXN_PROJECT" && wait_for_health "$_TXN_PROJECT"; then
    txn_phase "rolled_back"
    write_status "rolled_back" "restored ${_TXN_FROM} after a failed upgrade to ${_TXN_TO}" "$_TXN_FROM" "$_TXN_TO" "$_TXN_RID"
  else
    txn_phase "failed"
    write_status "failed" "the upgrade and the rollback both failed; manual recovery is required" "$_TXN_FROM" "$_TXN_TO" "$_TXN_RID"
  fi
  return 0
}

# --------------------------------------------------------------------------- #
# Request processing
# --------------------------------------------------------------------------- #
process_request() {
  # The trigger directory is writable by the less-privileged app (it holds no Docker
  # socket); this updater does. Treat the request file as untrusted input and harden the
  # handoff before parsing it.
  #
  # Symlink safety: a symlinked request must never be followed. Reading through it would
  # let a link planted in the volume redirect the updater's reads at a file outside it. mv
  # renames the link rather than its target, but reject and delete it outright instead.
  if [ -L "$REQUEST_FILE" ]; then
    log "refusing a symlinked request file"
    rm -f "$REQUEST_FILE" 2>/dev/null || true
    return 0
  fi
  # Size bound: a real request is a few hundred bytes. Refuse anything absurd before jq
  # sees it, so a truncated, garbage, or hostile file can't be parsed or exhaust memory.
  _reqsize=$(wc -c < "$REQUEST_FILE" 2>/dev/null || printf '0')
  if [ "${_reqsize:-0}" -gt "$REQUEST_MAX_BYTES" ] 2>/dev/null; then
    log "refusing an oversized request file (${_reqsize} bytes > ${REQUEST_MAX_BYTES})"
    rm -f "$REQUEST_FILE" 2>/dev/null || true
    return 0
  fi

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
  # Explicit override to proceed with a downgrade even if a pre-downgrade safety backup
  # could not be confirmed. Absent/false means refuse (a downgrade is destructive).
  _force=$(jq -r 'if .force == true then "true" else "false" end' "$CLAIM_FILE" 2>/dev/null || printf 'false')
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
    process_downgrade "$_tag" "$_rid" "$_from" "$_proj" "$_restore_point" "$_force"
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

  # Already on this tag: CONFIRM it is actually deployed and healthy before reporting
  # success. The env file records what was REQUESTED, not what is deployed; trusting it
  # alone is how an upgrade interrupted just after the tag was written looks "done".
  if [ "$_tag" = "$_from" ]; then
    if deployed_and_healthy "$_tag" "$_proj"; then
      write_status "healthy" "already running ${_tag}" "$_from" "$_tag" "$_rid"
      rm -f "$CLAIM_FILE"
      return 0
    fi
    log "env pins ${_tag} but it is not confirmed healthy; reconciling by redeploying it"
  fi

  log "upgrade requested: ${_from} -> ${_tag} (project ${_proj}, request ${_rid})"
  # Open a durable transaction so an interruption after this point is recovered on the
  # next start from recorded state, not by trusting the env file (see recover_transaction).
  txn_begin "upgrade" "$_from" "$_tag" "$_proj" "$_rid"
  # Fresh live log for this upgrade; the UI streams it from the first phase on.
  progress_reset
  progress_note "starting upgrade ${_from} -> ${_tag}"

  if [ "$_backup" = "true" ]; then
    txn_phase "backing_up"
    write_status "backing_up" "creating a pre-upgrade backup" "$_from" "$_tag" "$_rid"
    _bts=$(backup_and_wait) || _bts=""
    if [ -n "$_bts" ]; then
      _TXN_BACKUP_TS=$_bts
      txn_save
      # Remember this backup as the restore point for the version we're leaving.
      record_restore_point "$_from" "$_bts"
    elif [ "$REQUIRE_BACKUP" = "true" ]; then
      write_status "failed" "a pre-upgrade backup could not be confirmed" "$_from" "$_tag" "$_rid"
      txn_clear
      rm -f "$CLAIM_FILE"
      return 0
    else
      log "pre-upgrade backup not confirmed; continuing (image rollback still protects this upgrade)"
    fi
  fi

  txn_phase "validating"
  # Refuse to start when there clearly isn't room, instead of failing mid-download
  # and rolling back. Nothing has changed yet at this point, so the running version
  # is untouched and the admin gets an actionable message.
  _free=$(free_disk_mb)
  if [ -n "$_free" ] && [ "$_free" -lt "$DISK_MIN_MB" ]; then
    log "upgrade to ${_tag} refused: only ${_free}MB free, need ${DISK_MIN_MB}MB"
    write_status "failed" \
      "Not enough disk space: ${_free}MB free, ${DISK_MIN_MB}MB required. Free space on the server (docker image prune -af) and try again." \
      "$_from" "$_tag" "$_rid"
    txn_clear
    rm -f "$CLAIM_FILE"
    return 0
  fi

  # Record the exact local images the stack runs now, before anything changes, so the
  # rollback path can reuse them without the registry.
  _TXN_IMAGES=$(capture_stack_images "$_proj")
  txn_save

  txn_phase "pulling"
  write_status "pulling" "downloading ${IMAGE_REPO}:${_tag}" "$_from" "$_tag" "$_rid"
  if ! set_app_tag "$_tag"; then
    write_status "failed" "could not update the version in the environment file: ${SET_APP_TAG_ERROR:-unknown reason}" "$_from" "$_tag" "$_rid"
    progress_note "set_app_tag failed: ${SET_APP_TAG_ERROR:-unknown reason}"
    txn_clear
    rm -f "$CLAIM_FILE"
    return 0
  fi
  _TXN_ENV_CHANGED=true
  txn_save

  # Before the new images come up. The backup sidecar refuses to write an archive without its
  # key, and the app cannot store an encrypted setting without the secret key; an upgrade is
  # the moment an older install acquires the need for both.
  ensure_secret_key || true
  ensure_backup_key || true

  # If this release changed the stack layout, pull its compose in before recreating,
  # so a new service or healthcheck is applied as part of the same upgrade. Best
  # effort and self-reverting: the rollback path below restores the old file.
  apply_release_compose "$_tag" "$_proj"
  if [ -n "$_COMPOSE_BACKUP" ]; then
    _TXN_COMPOSE_REPLACED=true
    _TXN_COMPOSE_BACKUP=$_COMPOSE_BACKUP
    txn_phase "compose_updated"
  fi

  txn_phase "recreating"
  if recreate_app "$_proj"; then
    txn_phase "verifying"
    write_status "migrating" "waiting for ${_tag} to become healthy" "$_from" "$_tag" "$_rid"
    # The whole stack must be healthy (wait_for_health), and then stay healthy for the
    # stability window (stabilize_stack) before we commit. A version that comes up and
    # then crash-loops is caught here and rolled back instead of committed.
    if wait_for_health "$_proj"; then
      txn_phase "stabilizing"
      write_status "migrating" "confirming ${_tag} is stable" "$_from" "$_tag" "$_rid"
      if stabilize_stack "$_proj" "$_tag"; then
        _TXN_COMMITTED=true
        txn_phase "committed"
        write_status "healthy" "upgraded to ${_tag}" "$_from" "$_tag" "$_rid"
        log "upgrade to ${_tag} complete"
        # Only once the new version is up, healthy, and stable: keep it and the rollback
        # target, drop everything older.
        prune_old_images "$_tag" "$_from"
        # The new compose is proven good; drop its backup so they don't pile up.
        [ -n "$_COMPOSE_BACKUP" ] && rm -f "$_COMPOSE_BACKUP"
        txn_clear
        rm -f "$CLAIM_FILE"
        return 0
      fi
    fi
  fi

  # The upgrade failed; roll back to the previous version using local images.
  log "upgrade to ${_tag} failed; rolling back to ${_from}"
  rollback_upgrade
  txn_clear
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
  _force=${6:-false}

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

  # 1) Snapshot the CURRENT state first, so this downgrade is itself reversible. A
  # downgrade restores an older database and discards everything created since, so losing
  # this snapshot means the current state is unrecoverable. Refuse when it can't be
  # confirmed, unless the request explicitly forced it (an admin accepting that loss).
  write_status "backing_up" "backing up the current state before downgrading" "$_from" "$_tag" "$_rid"
  _sbts=$(backup_and_wait) || _sbts=""
  if [ -n "$_sbts" ]; then
    record_restore_point "$_from" "$_sbts"
  elif [ "$_force" = "true" ]; then
    log "safety backup before downgrade not confirmed; continuing because the request forced it"
    progress_note "no safety backup confirmed; continuing (forced)"
  else
    log "safety backup before downgrade not confirmed; refusing (not forced)"
    write_status "failed" \
      "Could not confirm a backup of the current state before downgrading, so the downgrade was refused to avoid unrecoverable data loss. Try again, or force it if you accept discarding the current state." \
      "$_from" "$_tag" "$_rid"
    return 0
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
  [ -n "$_ver" ] && printf '%s\n' "$_ver" > "$UPDATER_VERSION_FILE" 2>/dev/null || true
}

# Report whether the paths this updater resolved at startup still point at real files.
# Paths only, never their contents: the env file holds secrets.
stamp_updater_readiness() {
  _env_ok=false
  _compose_ok=false
  [ -f "$ENV_FILE" ] && [ -r "$ENV_FILE" ] && _env_ok=true
  [ -f "$COMPOSE_FILE" ] && [ -r "$COMPOSE_FILE" ] && _compose_ok=true
  jq -n \
    --arg envFile "$ENV_FILE" \
    --arg composeFile "$COMPOSE_FILE" \
    --argjson envFileOk "$_env_ok" \
    --argjson composeFileOk "$_compose_ok" \
    '{envFile:$envFile, composeFile:$composeFile, envFileOk:$envFileOk, composeFileOk:$composeFileOk}' \
    > "${UPDATER_READINESS_FILE}.tmp" 2>/dev/null &&
    mv "${UPDATER_READINESS_FILE}.tmp" "$UPDATER_READINESS_FILE" 2>/dev/null || true
}

# --------------------------------------------------------------------------- #
# Host facts
# --------------------------------------------------------------------------- #

# Read one KEY=value out of the host's os-release, unquoted.
host_os_release_field() {
  _field=$1
  [ -r "${HOST_ROOT}/etc/os-release" ] || return 0
  sed -n "s/^${_field}=//p" "${HOST_ROOT}/etc/os-release" 2>/dev/null |
    head -n 1 | sed 's/^"//; s/"$//'
}

# The first number on the line of the pending-updates notice that matches a phrase.
# The file is Ubuntu's own MOTD text, so it is matched loosely on purpose:
#   "28 updates can be applied immediately."
#   "5 of these updates are standard security updates."
host_update_count() {
  _phrase=$1
  _file="${HOST_ROOT}/var/lib/update-notifier/updates-available"
  [ -r "$_file" ] || return 0
  grep -i -- "$_phrase" "$_file" 2>/dev/null | head -n 1 |
    sed -n 's/^[^0-9]*\([0-9][0-9]*\).*/\1/p'
}

# Whether the host's clock is known to be in sync. Only systemd-timesyncd leaves a marker
# we can see; a host running chrony or ntpd reports null (unknown) rather than false,
# because "we cannot tell" and "the clock is wrong" are different answers and a wrong one
# here would send an operator chasing a problem they do not have. It matters at all
# because an LTI launch is signed and platforms allow only a few minutes of drift.
host_time_synchronised() {
  [ -d "${HOST_ROOT}/run/systemd/timesync" ] || return 0
  if [ -e "${HOST_ROOT}/run/systemd/timesync/synchronized" ]; then
    printf 'true'
  else
    printf 'false'
  fi
}

# Write what this container can see of the host it runs on. Everything is best-effort and
# absence is reported as absence: `supported` is false unless the host is recognisably
# Debian or Ubuntu with its /run mounted, so a Windows or unmounted install shows nothing
# at all rather than claiming a server is up to date on no evidence.
stamp_host_facts() {
  _os_id=$(host_os_release_field ID)
  _os_like=$(host_os_release_field ID_LIKE)
  _os_name=$(host_os_release_field PRETTY_NAME)

  _supported=false
  case " ${_os_id} ${_os_like} " in
    *" debian "*|*" ubuntu "*) [ -d "${HOST_ROOT}/run" ] && _supported=true ;;
  esac

  _reboot=false
  _pkgs='[]'
  _updates=null
  _security=null
  _synced=null

  if [ "$_supported" = true ]; then
    [ -f "${HOST_ROOT}/run/reboot-required" ] && _reboot=true
    if [ -r "${HOST_ROOT}/run/reboot-required.pkgs" ]; then
      _pkgs=$(sort -u "${HOST_ROOT}/run/reboot-required.pkgs" 2>/dev/null |
        grep -v '^[[:space:]]*$' | jq -R . | jq -s . 2>/dev/null) || _pkgs='[]'
      [ -n "$_pkgs" ] || _pkgs='[]'
    fi
    _n=$(host_update_count 'can be applied immediately')
    [ -n "$_n" ] && _updates=$_n
    _n=$(host_update_count 'security update')
    [ -n "$_n" ] && _security=$_n
    _n=$(host_time_synchronised)
    [ -n "$_n" ] && _synced=$_n
  fi

  jq -n \
    --arg checkedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg osName "$_os_name" \
    --argjson supported "$_supported" \
    --argjson rebootRequired "$_reboot" \
    --argjson rebootPackages "$_pkgs" \
    --argjson updatesAvailable "$_updates" \
    --argjson securityUpdatesAvailable "$_security" \
    --argjson timeSynchronised "$_synced" \
    '{checkedAt:$checkedAt, supported:$supported, osName:$osName,
      rebootRequired:$rebootRequired, rebootPackages:$rebootPackages,
      updatesAvailable:$updatesAvailable, securityUpdatesAvailable:$securityUpdatesAvailable,
      timeSynchronised:$timeSynchronised}' \
    > "${HOST_FACTS_FILE}.tmp" 2>/dev/null &&
    mv "${HOST_FACTS_FILE}.tmp" "$HOST_FACTS_FILE" 2>/dev/null || true
}

# This updater's own running version, recomputed live (same logic as stamp_updater_version
# but returned, not written), for the self-update confirmation handshake.
current_updater_version() {
  _self=$(this_container_id)
  [ -n "$_self" ] || return 0
  _ver=$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$_self" 2>/dev/null || printf '')
  if [ -z "$_ver" ]; then
    _img=$(docker inspect --format '{{.Config.Image}}' "$_self" 2>/dev/null || printf '')
    case "$_img" in
      *@*) : ;;
      *:*) _ver=${_img##*:} ;;
    esac
  fi
  printf '%s' "$_ver"
}

recreate_updater() {
  _proj=$1
  _self=$(this_container_id)
  [ -n "$_self" ] || { progress_note "could not determine the updater container"; return 1; }
  # The helper runs the updater's OWN image (it has docker + compose); the new image
  # is picked up by its `up -d`. `docker run -v` needs HOST paths, so resolve the host
  # sources backing this container's scoped compose and shared mounts.
  _self_image=$(docker inspect --format '{{.Config.Image}}' "$_self" 2>/dev/null || printf '')
  [ -n "$_self_image" ] || { progress_note "could not resolve the updater image"; return 1; }
  _compose_src=$(docker inspect \
    --format '{{ range .Mounts }}{{ if eq .Destination "/afct-compose" }}{{ .Source }}{{ end }}{{ end }}' \
    "$_self" 2>/dev/null || printf '')
  _shared_src=$(docker inspect \
    --format '{{ range .Mounts }}{{ if eq .Destination "/afct-shared" }}{{ .Source }}{{ end }}{{ end }}' \
    "$_self" 2>/dev/null || printf '')
  [ -n "$_compose_src" ] || { progress_note "could not resolve the runtime compose directory"; return 1; }
  [ -n "$_shared_src" ] || { progress_note "could not resolve the shared configuration directory"; return 1; }

  # Mount both source directories at their REAL host paths so every path the helper hands
  # the daemon (bind sources, the env_file the Compose file references via
  # AFCT_RUNTIME_ENV_FILE) resolves identically inside the helper and on the host. The
  # compose file and the env file may live in different directories (the versioned Linux
  # layout) or the same one (Windows, where both mounts point at the deploy directory);
  # mounting each at its own host path handles both without special-casing.
  _env_file="${_shared_src}/.env.production"
  _compose_file="${_compose_src}/docker-compose.yml"
  # All three interpolation variables have to be exported, not just the env file. The
  # Compose file builds this service's own mounts from
  # ${AFCT_RUNTIME_COMPOSE_DIR:-.}:/afct-compose and ${AFCT_RUNTIME_SHARED_DIR:-.}:/afct-shared,
  # so leaving either unset silently falls back to `.`, which Compose resolves against the
  # compose file's directory. On the versioned Linux layout the shared directory is the
  # PARENT of the runtime compose directory, so the replacement updater came back with
  # /afct-shared bound to the runtime directory and could no longer find .env.production:
  # every later upgrade failed with "no environment file at /afct-shared/.env.production"
  # until a host-side `afctctl update` recreated it. Resolve them from the mounts this
  # container actually has, so the replacement inherits the same layout.
  _cmd="sleep 3; export AFCT_RUNTIME_ENV_FILE='${_env_file}' AFCT_RUNTIME_COMPOSE_DIR='${_compose_src}' AFCT_RUNTIME_SHARED_DIR='${_shared_src}'; docker compose -p '${_proj}' --env-file '${_env_file}' -f '${_compose_file}' --profile updater up -d --no-deps ${UPDATER_SERVICE}"
  if [ "$_compose_src" = "$_shared_src" ]; then
    docker run -d --rm \
      -v /var/run/docker.sock:/var/run/docker.sock \
      -v "${_compose_src}:${_compose_src}" \
      "$_self_image" sh -c "$_cmd" >/dev/null 2>&1 || {
      progress_note "could not start the update-service swap helper"
      return 1
    }
  else
    docker run -d --rm \
      -v /var/run/docker.sock:/var/run/docker.sock \
      -v "${_compose_src}:${_compose_src}" \
      -v "${_shared_src}:${_shared_src}" \
      "$_self_image" sh -c "$_cmd" >/dev/null 2>&1 || {
      progress_note "could not start the update-service swap helper"
      return 1
    }
  fi
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

  # Hand off the container swap, then record a PENDING marker and leave the status at an
  # in-flight phase. We do NOT report success here: the swap replaces this container, and
  # only the replacement updater, once it confirms it is actually running ${_tag}, writes
  # the final "healthy" status (confirm_self_update on its startup). If the swap never
  # completes, the app's self-update timeout surfaces it; we never claim a false success.
  if recreate_updater "$_proj"; then
    _sup_tmp="${SELF_UPDATE_PENDING_FILE}.tmp.$$"
    if jq -n --arg tag "$_tag" --arg requestId "$_rid" --arg fromTag "$_from" \
         --arg at "$(_now_iso)" \
         '{tag:$tag, requestId:$requestId, fromTag:$fromTag, at:$at}' \
         > "$_sup_tmp" 2>/dev/null; then
      mv "$_sup_tmp" "$SELF_UPDATE_PENDING_FILE" 2>/dev/null || rm -f "$_sup_tmp"
    fi
    progress_note "update service ${_tag} downloaded; restarting and confirming the new version"
    write_status "self_updating" "restarting the update service to confirm ${_tag}" "$_from" "$_tag" "$_rid"
  else
    write_status "failed" "could not restart the update service" "$_from" "$_tag" "$_rid"
  fi
  return 0
}

# On startup, finalize a self-update the previous updater handed off: if this (the
# replacement) updater is actually running the requested version, write the final healthy
# status; if it came back on the wrong version, report that instead of a false success.
# Either way the pending marker is cleared so it is resolved exactly once.
confirm_self_update() {
  [ -f "$SELF_UPDATE_PENDING_FILE" ] || return 0
  if ! jq -e . "$SELF_UPDATE_PENDING_FILE" >/dev/null 2>&1; then
    rm -f "$SELF_UPDATE_PENDING_FILE"
    return 0
  fi
  _sup_tag=$(jq -r '.tag // ""' "$SELF_UPDATE_PENDING_FILE" 2>/dev/null || printf '')
  _sup_rid=$(jq -r '.requestId // ""' "$SELF_UPDATE_PENDING_FILE" 2>/dev/null || printf '')
  _sup_from=$(jq -r '.fromTag // ""' "$SELF_UPDATE_PENDING_FILE" 2>/dev/null || printf '')
  _now_ver=$(current_updater_version)
  if [ -n "$_sup_tag" ] && [ "$_now_ver" = "$_sup_tag" ]; then
    log "self-update confirmed: update service is running ${_sup_tag}"
    write_status "healthy" "update service updated to ${_sup_tag}" "$_sup_from" "$_sup_tag" "$_sup_rid"
  else
    log "self-update NOT confirmed: expected ${_sup_tag}, running ${_now_ver:-unknown}"
    write_status "failed" "the update service was downloaded but did not come back on ${_sup_tag} (it is on ${_now_ver:-unknown}); try again" "$_sup_from" "$_sup_tag" "$_sup_rid"
  fi
  rm -f "$SELF_UPDATE_PENDING_FILE"
}

# --------------------------------------------------------------------------- #
# Startup recovery of an interrupted update
#
# On start, resolve a transaction a crash or restart left unfinished, using the durable
# state plus the ACTUAL docker state rather than the env file's tag: commit an upgrade
# that in fact came up healthy, or roll back to the previous known-good version. This is
# authoritative, so it runs before the claim fallback and before the main loop.
# --------------------------------------------------------------------------- #
recover_transaction() {
  [ -f "$TXN_FILE" ] || return 0
  if ! jq -e . "$TXN_FILE" >/dev/null 2>&1; then
    log "discarding an unreadable transaction file"
    rm -f "$TXN_FILE"
    return 0
  fi
  _schema=$(jq -r '.schema // ""' "$TXN_FILE" 2>/dev/null || printf '')
  if [ "$_schema" != "$TXN_SCHEMA" ]; then
    log "discarding a transaction file with an unrecognized schema (${_schema})"
    rm -f "$TXN_FILE"
    return 0
  fi
  if [ "$(jq -r '.committed // false' "$TXN_FILE" 2>/dev/null || printf false)" = "true" ]; then
    rm -f "$TXN_FILE"
    return 0
  fi

  # Load the durable state into the in-memory mirror so the shared helpers can act on it.
  _TXN_ACTIVE=1
  _TXN_ACTION=$(jq -r '.action // ""' "$TXN_FILE")
  _TXN_PHASE=$(jq -r '.phase // ""' "$TXN_FILE")
  _TXN_START_PHASE=$(jq -r '.startPhase // ""' "$TXN_FILE")
  _TXN_FROM=$(jq -r '.fromTag // ""' "$TXN_FILE")
  _TXN_TO=$(jq -r '.toTag // ""' "$TXN_FILE")
  _TXN_PROJECT=$(jq -r '.project // ""' "$TXN_FILE")
  _TXN_RID=$(jq -r '.requestId // ""' "$TXN_FILE")
  _TXN_IMAGES=$(jq -c '.images // {}' "$TXN_FILE" 2>/dev/null || printf '{}')
  _TXN_ENV_CHANGED=$(jq -r '.envChanged // false' "$TXN_FILE")
  _TXN_COMPOSE_REPLACED=$(jq -r '.composeReplaced // false' "$TXN_FILE")
  _TXN_COMPOSE_BACKUP=$(jq -r '.composeBackup // ""' "$TXN_FILE")
  _COMPOSE_BACKUP=$_TXN_COMPOSE_BACKUP
  _TXN_BACKUP_TS=$(jq -r '.backupTimestamp // ""' "$TXN_FILE")
  _TXN_RESTORE_POINT=$(jq -r '.restorePoint // ""' "$TXN_FILE")
  _TXN_STARTED_AT=$(jq -r '.startedAt // ""' "$TXN_FILE")
  _TXN_COMMITTED=false

  # A stale claim for this same request must not be replayed after we resolve it here.
  rm -f "$CLAIM_FILE" 2>/dev/null || true

  # Docker may not be ready this early at boot; if the project can't be resolved, leave
  # the transaction file untouched for the next start rather than acting on a guess.
  _rproj=$(compose_project)
  if [ -z "$_rproj" ]; then
    log "recovery: cannot resolve the app container yet; will retry the interrupted ${_TXN_ACTION} on the next start"
    _TXN_ACTIVE=0
    return 0
  fi
  _TXN_PROJECT=$_rproj

  log "recovering an interrupted ${_TXN_ACTION}: ${_TXN_FROM} -> ${_TXN_TO} (was at phase ${_TXN_PHASE}, request ${_TXN_RID})"
  progress_note "recovering an interrupted update (was at: ${_TXN_PHASE})"

  # A downgrade restores the database; auto-resuming it could double-apply a destructive
  # restore, so surface it for manual recovery with the state we recorded instead.
  if [ "$_TXN_ACTION" != "upgrade" ]; then
    write_status "failed" "an interrupted ${_TXN_ACTION} needs manual recovery; check the database and version state" "$_TXN_FROM" "$_TXN_TO" "$_TXN_RID"
    txn_clear
    return 0
  fi

  # The new version actually came up healthy: the upgrade effectively finished, so commit
  # it rather than rolling a good version back over a late crash.
  if deployed_and_healthy "$_TXN_TO" "$_TXN_PROJECT"; then
    log "recovery: ${_TXN_TO} is deployed and healthy; committing the interrupted upgrade"
    _TXN_COMMITTED=true
    txn_phase "committed"
    write_status "healthy" "upgraded to ${_TXN_TO}" "$_TXN_FROM" "$_TXN_TO" "$_TXN_RID"
    prune_old_images "$_TXN_TO" "$_TXN_FROM"
    [ -n "$_COMPOSE_BACKUP" ] && rm -f "$_COMPOSE_BACKUP"
    txn_clear
    return 0
  fi

  # Otherwise return to the previous known-good version using local images.
  log "recovery: ${_TXN_TO} is not confirmed healthy; rolling back to ${_TXN_FROM}"
  rollback_upgrade
  txn_clear
  return 0
}

# --------------------------------------------------------------------------- #
# Main loop
# --------------------------------------------------------------------------- #
log "AFCT updater started (watching ${TRIGGER_DIR})"
stamp_updater_version
stamp_updater_readiness
stamp_host_facts
HOST_FACTS_STAMPED_AT=$(date +%s 2>/dev/null || printf '0')
beat
# Say it in the log too, so `docker logs` shows the misconfiguration without the app.
[ -f "$ENV_FILE" ] || log "WARNING: no environment file at ${ENV_FILE}; upgrades will fail until this updater is recreated"
[ -f "$COMPOSE_FILE" ] || log "WARNING: no compose file at ${COMPOSE_FILE}; upgrades will fail until this updater is recreated"

# If the previous updater handed off a self-update, this replacement confirms it is now
# running the requested version and writes the final status (or reports a mismatch).
confirm_self_update

# Resolve any durable transaction left unfinished by a crash or restart first: it is
# authoritative over the env file, and it also clears the matching stale claim.
recover_transaction

# Fallback for a request that was claimed but crashed BEFORE a transaction was opened
# (nothing had changed yet): re-queue it, unless a newer request already superseded it,
# in which case discard the stale claim rather than clobbering the pending request.
if [ -f "$CLAIM_FILE" ]; then
  if [ -f "$REQUEST_FILE" ]; then
    rm -f "$CLAIM_FILE" 2>/dev/null || true
  else
    mv "$CLAIM_FILE" "$REQUEST_FILE" 2>/dev/null || true
  fi
fi

while :; do
  beat
  # Re-stamped each poll rather than only at startup: the operator can fix a bad mount or
  # restore a missing env file on the host, and the Updates tab should clear on its own.
  stamp_updater_readiness
  # Host facts change on the scale of an apt run, not a poll, and reading them costs a
  # handful of processes, so they are refreshed on their own slower clock.
  _now=$(date +%s 2>/dev/null || printf '0')
  if [ $((_now - HOST_FACTS_STAMPED_AT)) -ge "$HOST_FACTS_INTERVAL" ]; then
    stamp_host_facts
    HOST_FACTS_STAMPED_AT=$_now
  fi
  if [ -f "$REQUEST_FILE" ]; then
    process_request || log "request processing raised an unexpected error"
  fi
  [ "$ONCE" = "true" ] && break
  sleep "$POLL_INTERVAL"
done
