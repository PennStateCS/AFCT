#!/bin/sh
# The shared deploy-state file and Docker Compose project-name resolution.
#
# The project name is the single most dangerous thing to get wrong: Compose derives it
# from the deploy directory's basename, so a mismatch would silently switch it and orphan
# the data volumes. We resolve it once, preferring the name on the running app container
# (authoritative), then the persisted state, then the name inferred from the EXISTING
# Docker volumes, then the default, and persist it so every later command reuses it.
#
# Sourced by afctctl; defines functions only. Reads globals set by afctctl (SHARED_DIR,
# PREFIX, ENV_FILE, COMPOSE_FILE, COMPOSE_KIND, COMPOSE_PROJECT_NAME).
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

# Remove a single key from the state file atomically. Returns non-zero on failure so a
# caller that must keep the file and state consistent can react.
state_unset() {
  _sf=$(state_file)
  [ -f "$_sf" ] || return 0
  _k=$1
  _tmp=$(mktemp "${_sf}.XXXXXX" 2>/dev/null) || return 1
  awk -v k="$_k" 'index($0, k "=") == 1 { next } { print }' "$_sf" > "$_tmp" || { rm -f "$_tmp"; return 1; }
  chmod 600 "$_tmp" 2>/dev/null || true
  mv "$_tmp" "$_sf" || { rm -f "$_tmp"; return 1; }
  own_deploy_path "$_sf"
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

# Resolve the Compose project name once and persist it. Resolution order, strongest first:
#   1. the running app container's Compose project label (exactly where Docker recreates)
#   2. the already-persisted deployment state
#   3. an exact match against the COMPLETE existing AFCT volume set
#   4. the default "afct"
# The chosen name is validated against Compose's project-name rules, then persisted. During
# install/migration a persist failure is FATAL: the project name is what keeps the existing
# data volumes attached, so silently continuing could orphan them.
resolve_and_persist_project_name() {
  _name=$(project_name_from_container_label)
  _name=$(printf '%s' "$_name" | tr -d ' \011\012')

  [ -n "$_name" ] || _name=$(state_get PROJECT_NAME)
  [ -n "$_name" ] || _name=$(detect_project_name_from_volumes)
  [ -n "$_name" ] || _name="afct"

  valid_compose_project_name "$_name" || \
    die "resolved an invalid Docker Compose project name '${_name}'. Reinstall to correct it."

  COMPOSE_PROJECT_NAME=$_name
  state_set PROJECT_NAME "$_name" || \
    die "could not persist the Docker Compose project name to ${SHARED_DIR}. Refusing to continue: this value keeps the existing data volumes attached."
  info "using Docker Compose project name '${_name}' (keeps existing data volumes attached)."
}
