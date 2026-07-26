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

# Run compose against the versioned file + shared env with the pinned project name.
# Uses the production env file explicitly and prevents exported managed variables in the
# invoking shell from unexpectedly overriding the saved installation config.
compose_project() {
  (
    unset NODE_ENV POSTGRES_PASSWORD DATABASE_URL ADMIN_EMAIL ADMIN_PASSWORD \
      NEXTAUTH_SECRET NEXTAUTH_URL AUTH_TRUST_HOST

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
  if [ "${LOG_ENABLED:-false}" = "true" ]; then
    if ! compose_project config >/dev/null 2>> "$LOG_FILE"; then
      die "the Docker Compose configuration is invalid. Review ${LOG_FILE}."
    fi
  else
    if ! compose_project config >/dev/null; then
      die "the Docker Compose configuration is invalid."
    fi
  fi
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
  for _volume in $_volumes; do
    docker_cmd volume ls --format '{{.Name}}' 2>/dev/null | grep -Eq "(^|_)${_volume}$" && return 0
  done
  return 1
}
