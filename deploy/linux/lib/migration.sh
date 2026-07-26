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

# A valid Docker Compose project name: lowercase alphanumerics, dashes, and underscores,
# starting with an alphanumeric. Reject anything else before persisting it.
valid_compose_project_name() {
  case "$1" in
    ''|*[!a-z0-9_-]*) return 1 ;;
    [!a-z0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

# The Compose project name recorded on the RUNNING app container, or nothing. This is the
# strongest source of truth: it is exactly the project Docker will recreate into, so it
# cannot disagree with reality the way an inferred name can. Never prompts, never fails.
project_name_from_container_label() {
  resolve_docker_access_soft || return 0
  [ -n "$COMPOSE_KIND" ] || return 0
  _cid=${AFCT_APP_CONTAINER:-afct-app}
  docker_cmd inspect "$_cid" \
    --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true
}

# The project name inferred from the EXISTING AFCT data volumes, or nothing. A candidate is
# accepted only when the COMPLETE expected volume set exists for it (<project>_<vol> for
# every Compose volume), so a single incidental suffix match on one unrelated volume can
# never select the wrong project. Never prompts and never fails the caller.
detect_project_name_from_volumes() {
  resolve_docker_access_soft || return 0
  [ -n "$COMPOSE_KIND" ] || return 0
  [ -f "$COMPOSE_FILE" ] || return 0
  _vols=$(compose_raw -f "$COMPOSE_FILE" config --volumes 2>/dev/null)
  [ -n "$_vols" ] || return 0
  _all=$(docker_cmd volume ls --format '{{.Name}}' 2>/dev/null)
  [ -n "$_all" ] || return 0

  # Candidate project prefixes: every docker volume whose name ends in "_<first-vol>".
  _first=$(printf '%s\n' "$_vols" | sed -n '1p')
  [ -n "$_first" ] || return 0
  printf '%s\n' "$_all" | awk -v suf="_$_first" '
    { n = length($0); m = length(suf); if (n > m && substr($0, n - m + 1) == suf) print substr($0, 1, n - m) }' |
  while IFS= read -r _cand; do
    [ -n "$_cand" ] || continue
    _complete=1
    for _v in $_vols; do
      printf '%s\n' "$_all" | grep -qx "${_cand}_${_v}" || { _complete=0; break; }
    done
    if [ "$_complete" = "1" ]; then
      printf '%s' "$_cand"
      break
    fi
  done
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

# Resolve the Compose project name once and persist it. Resolution order, strongest first:
#   1. the running app container's Compose project label (exactly where Docker recreates)
#   2. the already-persisted deployment state
#   3. an exact match against the COMPLETE existing AFCT volume set
#   4. the legacy deployment directory basename (normalized)
#   5. the default "afct"
# The chosen name is validated against Compose's project-name rules, then persisted. During
# install/migration a persist failure is FATAL: the project name is what keeps the existing
# data volumes attached, so silently continuing could orphan them.
resolve_and_persist_project_name() {
  _name=$(project_name_from_container_label)
  _name=$(printf '%s' "$_name" | tr -d ' \011\012')

  [ -n "$_name" ] || _name=$(state_get PROJECT_NAME)
  [ -n "$_name" ] || _name=$(detect_project_name_from_volumes)
  if [ -z "$_name" ]; then
    _src=$(legacy_source_dir)
    [ -n "$_src" ] && _name=$(docker_normalize_name "$(basename "$_src")")
  fi
  [ -n "$_name" ] || _name="afct"

  valid_compose_project_name "$_name" || \
    die "resolved an invalid Docker Compose project name '${_name}'. Set AFCT_LEGACY_DIR or reinstall to correct it."

  COMPOSE_PROJECT_NAME=$_name
  state_set PROJECT_NAME "$_name" || \
    die "could not persist the Docker Compose project name to ${SHARED_DIR}. Refusing to continue: this value keeps the existing data volumes attached."
  info "using Docker Compose project name '${_name}' (keeps existing data volumes attached)."
}

# Migrate a legacy flat installation without deploying: preserve the previous service-account
# mode (before creating any account), move the configuration/backups/log/marker into the
# shared directory, and pin the Compose project name. Idempotent and safe to re-run; run by
# the compatibility shim before it forwards the user's original command.
do_migrate_legacy() {
  preserve_or_setup_service_account
  migrate_legacy_install
  # Ensure the project name is resolved and persisted even when there was nothing to move
  # (a genuinely fresh system): later commands then reuse it.
  resolve_and_persist_project_name
  success "Legacy migration complete."
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
