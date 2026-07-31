#!/bin/sh
# Docker Compose wrappers and the update rollback snapshot for afctctl.
#
# Sourced by afctctl; defines functions only. Reads globals set by afctctl (COMPOSE_KIND,
# COMPOSE_FILE, ENV_FILE, COMPOSE_PROJECT_NAME, SERVICE_MODE, DOCKER_SUDO,
# UPDATE_IMAGE_SNAPSHOT, LOG_ENABLED, LOG_FILE).
#
# IMPORTANT: every compose invocation pins the project name with `-p
# $COMPOSE_PROJECT_NAME` and points at the versioned COMPOSE_FILE by absolute path. That
# is what keeps the Docker volumes attached to the SAME project after the deploy files
# move into /opt/afct/releases/<ver>/ (the default project name is the compose file's
# directory basename, which would otherwise change and orphan the data).
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl

compose_raw() {
  case "$COMPOSE_KIND" in
    v2) docker_cmd compose "$@" ;;
    v1)
      if [ "${SERVICE_MODE:-false}" = "true" ]; then
        run_as_service docker-compose "$@"
      elif [ -n "${DOCKER_SUDO:-}" ]; then
        sudo docker-compose "$@"
      else
        docker-compose "$@"
      fi
      ;;
    *) return 127 ;;
  esac
}

# Emits `--profile updater` (as two words) when the in-app updater sidecar is enabled,
# so every compose action includes it. Empty otherwise.
updater_profile_args() {
  if [ "$(read_env_value AFCT_UPDATER_ENABLED "$ENV_FILE" 2>/dev/null)" = "true" ]; then
    printf '%s' '--profile updater'
  fi
  # Always succeed: `_profile=$(updater_profile_args)` under `set -e` must not abort when
  # the updater is disabled (the bare test would otherwise return non-zero).
  return 0
}

# Restore the recorded runtime-Compose checksum to a prior value, or clear it when there
# was none. Used on the rollback path so deploy.state never records a checksum that no
# published runtime file matches.
_restore_runtime_sha() {
  if [ -n "${1:-}" ]; then
    state_set RUNTIME_COMPOSE_SHA "$1" || true
  else
    state_unset RUNTIME_COMPOSE_SHA || true
  fi
}

# Publish the mutable runtime Compose file from <src> as a transaction: stage a copy,
# checksum it, record the intended checksum in deploy.state FIRST, publish the file
# atomically, then verify the published bytes match the record. Any failure restores BOTH
# the previous file and the previous state, so the runtime file and deploy.state are never
# left disagreeing and a new file is never installed without matching provenance.
_write_runtime_compose() {
  _src=$1
  _rt=$COMPOSE_FILE
  _rt_dir=$(dirname "$_rt")
  mkdir -p "$_rt_dir" 2>/dev/null || die "could not create the runtime Compose directory ${_rt_dir}."

  # 1) Stage the candidate and compute its digest.
  _new=$(mktemp "${_rt}.new.XXXXXX" 2>/dev/null) || die "could not stage the runtime Compose file."
  cp "$_src" "$_new" || { rm -f "$_new"; die "could not stage the runtime Compose file."; }
  chmod 600 "$_new" 2>/dev/null || true
  _newsha=$(sha_of "$_new")
  [ -n "$_newsha" ] || { rm -f "$_new"; die "could not checksum the staged runtime Compose file."; }

  # 2) Snapshot the current file + recorded checksum so both can roll back together.
  _bak=""
  if [ -f "$_rt" ]; then
    _bak=$(mktemp "${_rt}.bak.XXXXXX" 2>/dev/null) || { rm -f "$_new"; die "could not back up the runtime Compose file."; }
    cp -p "$_rt" "$_bak" 2>/dev/null || { rm -f "$_new" "$_bak"; die "could not back up the runtime Compose file."; }
  fi
  _oldsha=$(state_get RUNTIME_COMPOSE_SHA)

  # 3) Record the intended checksum FIRST. If this fails, nothing has been published yet.
  if ! state_set RUNTIME_COMPOSE_SHA "$_newsha"; then
    rm -f "$_new"; [ -n "$_bak" ] && rm -f "$_bak"
    die "could not persist the runtime Compose provenance to ${SHARED_DIR}; runtime Compose left unchanged."
  fi

  # 4) Publish atomically.
  if ! mv "$_new" "$_rt"; then
    rm -f "$_new" 2>/dev/null || true
    [ -n "$_bak" ] && mv "$_bak" "$_rt" 2>/dev/null || true
    _restore_runtime_sha "$_oldsha"
    die "could not publish the runtime Compose file; restored the previous file and state."
  fi
  own_deploy_path "$_rt"
  chmod 600 "$_rt" 2>/dev/null || true

  # 5) Verify the published bytes match what state records; roll back both if not.
  if [ "$(sha_of "$_rt")" != "$_newsha" ]; then
    if [ -n "$_bak" ]; then
      mv "$_bak" "$_rt" 2>/dev/null || true
    else
      rm -f "$_rt" 2>/dev/null || true
    fi
    _restore_runtime_sha "$_oldsha"
    die "the runtime Compose file did not match its recorded checksum after publish; restored the previous state."
  fi
  [ -n "$_bak" ] && rm -f "$_bak" 2>/dev/null || true
}

# Seed or refresh the mutable runtime Compose file from the active release. The runtime
# file is the single stack definition afctctl and the updater both drive, so release
# directories are never modified after install. Skipped when AFCT_COMPOSE_FILE overrides
# the location (tests and bespoke deployments manage their own file).
ensure_runtime_compose() {
  [ -z "${AFCT_COMPOSE_FILE:-}" ] || return 0
  [ -f "$RELEASE_COMPOSE_FILE" ] || return 0
  if [ ! -f "$COMPOSE_FILE" ]; then
    _write_runtime_compose "$RELEASE_COMPOSE_FILE"
    return 0
  fi
  # Nothing to do when the runtime file already equals the active release.
  cmp -s "$RELEASE_COMPOSE_FILE" "$COMPOSE_FILE" && return 0
  # The runtime file differs from the release. Refresh it ONLY when afctctl last wrote it
  # (its recorded checksum still matches the file on disk); otherwise it was changed by the
  # in-app updater or an administrator, and must be left in place.
  _cur=$(sha_of "$COMPOSE_FILE")
  _rec=$(state_get RUNTIME_COMPOSE_SHA)
  if [ -n "$_rec" ] && [ "$_cur" = "$_rec" ]; then
    info "refreshing the runtime Compose file from the active release."
    _write_runtime_compose "$RELEASE_COMPOSE_FILE"
  else
    info "runtime Compose file differs from the active release and was changed outside afctctl (the in-app updater or a manual edit); leaving it in place. Run 'afctctl update' to apply application changes."
  fi
}

# Run compose against the runtime file + shared env with the pinned project name. Exports
# the runtime path variables the Compose file interpolates (the per-service env_file and
# the updater's scoped bind mounts) so they resolve to the shared/runtime locations rather
# than the co-located defaults the Windows installer relies on.
# Uses the production env file explicitly and prevents exported managed variables in the
# invoking shell from unexpectedly overriding the saved installation config.
compose_project() {
  (
    unset NODE_ENV POSTGRES_PASSWORD DATABASE_URL ADMIN_EMAIL ADMIN_PASSWORD \
      NEXTAUTH_SECRET NEXTAUTH_URL AUTH_TRUST_HOST

    AFCT_RUNTIME_ENV_FILE="$ENV_FILE"
    AFCT_RUNTIME_COMPOSE_DIR=$(dirname "$COMPOSE_FILE")
    AFCT_RUNTIME_SHARED_DIR=$(dirname "$ENV_FILE")
    export AFCT_RUNTIME_ENV_FILE AFCT_RUNTIME_COMPOSE_DIR AFCT_RUNTIME_SHARED_DIR

    # docker compose stats its working directory even with -f/--env-file absolute paths.
    # Under the service account that blows up when afctctl was launched from a directory
    # the account cannot read (e.g. root's home): "stat .: permission denied". Run from
    # the runtime compose dir instead; this subshell keeps the cd from leaking.
    cd "$AFCT_RUNTIME_COMPOSE_DIR" 2>/dev/null || true

    # Unquoted on purpose: expands to `--profile updater` or to nothing.
    _profile=$(updater_profile_args)
    # shellcheck disable=SC2086  # word-splitting $_profile is the intended behavior here
    if [ -f "$ENV_FILE" ]; then
      compose_raw $_profile -p "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
    else
      compose_raw $_profile -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
    fi
  )
}

compose_volume_names() {
  compose_project config --volumes 2>/dev/null || true
}

validate_compose() {
  # Capture stderr so a failure reports the actual reason (e.g. a missing env file) rather
  # than a bare "invalid configuration" the operator cannot act on.
  _compose_err=$(compose_project config 2>&1 >/dev/null) || {
    if [ "${LOG_ENABLED:-false}" = "true" ]; then
      printf '%s\n' "$_compose_err" >> "$LOG_FILE"
    fi
    _compose_detail=$(printf '%s' "$_compose_err" | tail -n3 | tr '\n' ' ')
    if [ -n "$_compose_detail" ]; then
      die "the Docker Compose configuration is invalid: ${_compose_detail}"
    fi
    die "the Docker Compose configuration is invalid."
  }
}

capture_running_images() {
  UPDATE_IMAGE_SNAPSHOT=$(mktemp "${TMPDIR:-/tmp}/afct-images.XXXXXX") || \
    die "could not create an update rollback snapshot."
  : > "$UPDATE_IMAGE_SNAPSHOT"

  # The explicit `if` keeps the loop's exit status 0 when the LAST reference is not
  # local (normal on a pinned update, whose new tag is not pulled yet); the bare
  # `[ -n ] && printf` form made the pipeline fail and set -e abort the whole update.
  compose_project config --images 2>/dev/null | while IFS= read -r _reference; do
    [ -n "$_reference" ] || continue
    _id=$(docker_cmd image inspect -f '{{.Id}}' "$_reference" 2>/dev/null || true)
    if [ -n "$_id" ]; then printf '%s|%s\n' "$_reference" "$_id"; fi
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

  if [ "${LOG_ENABLED:-false}" = "true" ]; then
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

# True (0) when AFCT data volumes exist but the config is missing/incomplete: the signal
# to recover rather than generate fresh database credentials.
existing_data_without_config() {
  [ -f "$ENV_FILE" ] && env_file_complete "$ENV_FILE" && return 1
  resolve_docker_access_soft || return 1
  [ -n "$COMPOSE_KIND" ] || return 1
  _volumes=$(compose_volume_names)
  [ -n "$_volumes" ] || return 1
  # Match only the volumes THIS project would reuse. Compose names them
  # "<project>_<volume>", so an exact name match ignores AFCT volumes left behind by an
  # install under a different project name (harmless leftovers that must not block a fresh,
  # non-colliding install). Matching by suffix across every project was the old bug. Without
  # a resolved project name, do not block.
  [ -n "$COMPOSE_PROJECT_NAME" ] || return 1
  _existing=$(docker_cmd volume ls --format '{{.Name}}' 2>/dev/null || true)
  for _volume in $_volumes; do
    printf '%s\n' "$_existing" | grep -Fxq "${COMPOSE_PROJECT_NAME}_${_volume}" && return 0
  done
  return 1
}
