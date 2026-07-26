#!/bin/sh
# Migration of a legacy flat AFCT install into the /opt/afct layout, plus the shared
# deploy-state file and Docker Compose project-name resolution.
#
# The project name is the single most dangerous thing to get wrong: Compose derives it
# from the deploy directory's basename, so moving files would silently switch it and
# orphan the data volumes. We resolve it once, preferring the name inferred from the
# EXISTING Docker volumes (authoritative), then a legacy directory basename, then the
# default, and persist it so every later command reuses it.
#
# Sourced by afctctl; defines functions only. Reads globals set by afctctl (SHARED_DIR,
# PREFIX, ENV_FILE, COMPOSE_FILE, COMPOSE_KIND, COMPOSE_PROJECT_NAME, SERVICE_MARKER_NAME)
# and the AFCT_LEGACY_DIR override.
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl

state_file() {
  printf '%s/deploy.state' "$SHARED_DIR"
}

state_get() {
  _sf=$(state_file)
  [ -f "$_sf" ] || return 0
  awk -v k="$1" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' "$_sf" 2>/dev/null || true
}

state_set() {
  _sf=$(state_file)
  _k=$1
  _v=$2
  mkdir -p "$SHARED_DIR" 2>/dev/null || true
  _tmp=$(mktemp "${_sf}.XXXXXX" 2>/dev/null) || return 1
  if [ -f "$_sf" ]; then
    awk -v k="$_k" 'index($0, k "=") == 1 { next } { print }' "$_sf" > "$_tmp" || { rm -f "$_tmp"; return 1; }
  fi
  printf '%s=%s\n' "$_k" "$_v" >> "$_tmp"
  chmod 600 "$_tmp" 2>/dev/null || true
  mv "$_tmp" "$_sf" || { rm -f "$_tmp"; return 1; }
  own_deploy_path "$_sf"
}

# Normalize a directory basename to a Docker Compose project name the way Compose does:
# lowercase, keep only [a-z0-9_-], and strip any leading separators.
docker_normalize_name() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]//g; s/^[^a-z0-9]*//'
}

# The project name inferred from an existing AFCT volume, or nothing. A live volume named
# "<project>_<shortname>" is proof of the project the data belongs to, so this is the most
# reliable source. Never prompts and never fails the caller.
detect_project_name_from_volumes() {
  resolve_docker_access_soft || return 0
  [ -n "$COMPOSE_KIND" ] || return 0
  [ -f "$COMPOSE_FILE" ] || return 0
  _short=$(compose_raw -f "$COMPOSE_FILE" config --volumes 2>/dev/null | sed -n '1p')
  [ -n "$_short" ] || return 0
  docker_cmd volume ls --format '{{.Name}}' 2>/dev/null | awk -v suf="_$_short" '
    {
      n = length($0); m = length(suf)
      if (n > m && substr($0, n - m + 1) == suf) { print substr($0, 1, n - m); exit }
    }'
}

# The legacy flat deploy directory to migrate from, or nothing. AFCT_LEGACY_DIR wins (for
# an install that lived somewhere other than /opt/afct); otherwise a flat .env.production
# at the install root (an in-place upgrade of an /opt/afct flat install).
legacy_source_dir() {
  if [ -n "${AFCT_LEGACY_DIR:-}" ] && [ -f "${AFCT_LEGACY_DIR}/.env.production" ]; then
    printf '%s' "$AFCT_LEGACY_DIR"
    return 0
  fi
  # ENV_FILE is $PREFIX/shared/.env.production, so a file directly at $PREFIX is legacy.
  if [ -f "${PREFIX}/.env.production" ]; then
    printf '%s' "$PREFIX"
    return 0
  fi
  return 0
}

# Resolve the Compose project name once and persist it. Order: already-persisted, then
# inferred from existing volumes, then the legacy directory basename, then "afct".
resolve_and_persist_project_name() {
  _existing=$(state_get PROJECT_NAME)
  if [ -n "$_existing" ]; then
    COMPOSE_PROJECT_NAME=$_existing
    return 0
  fi

  _name=$(detect_project_name_from_volumes)
  if [ -z "$_name" ]; then
    _src=$(legacy_source_dir)
    [ -n "$_src" ] && _name=$(docker_normalize_name "$(basename "$_src")")
  fi
  [ -n "$_name" ] || _name="afct"

  COMPOSE_PROJECT_NAME=$_name
  state_set PROJECT_NAME "$_name" || true
  info "using Docker Compose project name '${_name}' (keeps existing data volumes attached)."
}

# Move a legacy flat install's persistent files into the shared directory, preserving
# them. Idempotent: every step is guarded, so an interrupted run can be re-run safely.
# Never rotates secrets, never touches Docker volumes, never re-seeds the admin account.
migrate_legacy_install() {
  _src=$(legacy_source_dir)
  [ -n "$_src" ] || return 0

  # The shared env already existing means migration has already run; only make sure the
  # project name is pinned and stop.
  if [ -f "$ENV_FILE" ]; then
    resolve_and_persist_project_name
    return 0
  fi

  heading "Migrating an existing AFCT installation"
  info "found a legacy deployment in ${_src}; moving its configuration into ${SHARED_DIR}."
  mkdir -p "$SHARED_DIR" || die "could not create ${SHARED_DIR}."

  # Pin the project name from the live volumes/basename BEFORE anything else, so a later
  # deploy reuses the same data.
  resolve_and_persist_project_name

  # The configuration itself (contains the secrets that match the existing volumes).
  if [ -f "${_src}/.env.production" ]; then
    cp -p "${_src}/.env.production" "$ENV_FILE" || die "could not copy the existing .env.production."
    chmod 600 "$ENV_FILE" 2>/dev/null || true
    own_deploy_path "$ENV_FILE"
    env_file_complete "$ENV_FILE" || die "the migrated .env.production is incomplete; not removing the original at ${_src}."
    # Only remove the source once the copy is verified complete.
    [ "$_src" = "$PREFIX" ] && rm -f "${_src}/.env.production" 2>/dev/null || true
    success "Preserved the existing configuration."
  fi

  # Protected configuration backups.
  for _b in "${_src}"/.env.production.backup.*; do
    [ -f "$_b" ] || continue
    _dest="${SHARED_DIR}/$(basename "$_b")"
    [ -f "$_dest" ] && continue
    cp -p "$_b" "$_dest" 2>/dev/null && { chmod 600 "$_dest" 2>/dev/null || true; own_deploy_path "$_dest"; }
    [ "$_src" = "$PREFIX" ] && rm -f "$_b" 2>/dev/null || true
  done

  # The installer log, where practical.
  if [ -f "${_src}/install.log" ] && [ ! -f "${SHARED_DIR}/install.log" ]; then
    cp -p "${_src}/install.log" "${SHARED_DIR}/install.log" 2>/dev/null && \
      { chmod 600 "${SHARED_DIR}/install.log" 2>/dev/null || true; own_deploy_path "${SHARED_DIR}/install.log"; }
  fi

  # The service-account marker, so service mode is preserved.
  if [ -f "${_src}/${SERVICE_MARKER_NAME}" ] && [ ! -f "${SHARED_DIR}/${SERVICE_MARKER_NAME}" ]; then
    cp -p "${_src}/${SERVICE_MARKER_NAME}" "${SHARED_DIR}/${SERVICE_MARKER_NAME}" 2>/dev/null || true
    [ "$_src" = "$PREFIX" ] && rm -f "${_src}/${SERVICE_MARKER_NAME}" 2>/dev/null || true
  fi

  # A legacy flat install root also holds an install.sh / docker-compose.yml; leave them
  # untouched. The new tooling uses the versioned bundle, and removing the old files is
  # not required for correctness.
  success "Migration complete. Configuration and backups now live in ${SHARED_DIR}."
}
