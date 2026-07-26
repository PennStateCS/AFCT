#!/bin/sh
# Dedicated service-account handling for afctctl.
#
# When afctctl runs as root, a fresh install can deploy under a system account (default
# `afct`): the /opt/afct tree and the Docker-socket membership belong to a purpose-built
# user that survives staff turnover. Unlike the old installer there is no relocate/re-exec
# step: the bootstrap already placed the tooling under /opt/afct, so this only creates the
# account, owns the tree, writes the marker into the shared directory, and re-enters
# service mode on later runs.
#
# Sourced by afctctl; defines functions only. Reads globals set by afctctl (SERVICE_USER,
# SERVICE_MODE, SERVICE_MARKER_NAME, PREFIX, SHARED_DIR, ASSUME_YES).
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl

service_user_enabled() {
  case "$SERVICE_USER" in
    ""|none|off|no|disabled) return 1 ;;
    *) return 0 ;;
  esac
}

# The service account's primary group name. Always resolvable once the account exists;
# falls back to the username so a chown string is never empty.
service_user_group() {
  id -gn "$SERVICE_USER" 2>/dev/null || printf '%s' "$SERVICE_USER"
}

create_service_user() {
  id "$SERVICE_USER" >/dev/null 2>&1 && return 0
  mkdir -p "$PREFIX" 2>/dev/null || true
  if command -v useradd >/dev/null 2>&1; then
    useradd --system --home-dir "$PREFIX" --shell /usr/sbin/nologin "$SERVICE_USER" 2>/dev/null \
      || useradd -r -d "$PREFIX" -s /bin/false "$SERVICE_USER" 2>/dev/null || true
  elif command -v adduser >/dev/null 2>&1; then
    # busybox/alpine adduser: -S system, -H no home creation (PREFIX already exists).
    adduser -S -H -h "$PREFIX" -s /sbin/nologin "$SERVICE_USER" 2>/dev/null || true
  fi
  id "$SERVICE_USER" >/dev/null 2>&1
}

add_service_user_to_docker_group() {
  # Rootless or socket-permission setups may not use a docker group; nothing to do.
  getent group docker >/dev/null 2>&1 || return 0
  if command -v usermod >/dev/null 2>&1; then
    usermod -aG docker "$SERVICE_USER" 2>/dev/null || true
  elif command -v addgroup >/dev/null 2>&1; then
    addgroup "$SERVICE_USER" docker 2>/dev/null || true
  fi
}

# Verify the service account can reach the Docker daemon, adding it to the docker group
# first. Fatal if it still can't: better a clear message here than a cryptic mid-deploy
# failure.
ensure_service_docker_access() {
  add_service_user_to_docker_group
  run_as_service docker info >/dev/null 2>&1 && return 0
  die "the '${SERVICE_USER}' service account cannot reach Docker. Ensure a 'docker' group exists and the account belongs to it, or reinstall with --no-service-user."
}

# Give the whole /opt/afct tree to the service account so it can read every release and
# the shared configuration.
own_service_tree() {
  [ "$(id -u 2>/dev/null || echo 1)" = "0" ] || return 0
  chown -R "$SERVICE_USER:$(service_user_group)" "$PREFIX" 2>/dev/null || true
}

# Re-enter service mode on a later run when this deployment is service-account managed.
# The marker lives in the shared directory; a legacy flat install may still have it at the
# deploy root, so check both. Root only: a non-root run can't act as the account.
activate_service_mode_from_marker() {
  [ "$(id -u 2>/dev/null || echo 1)" = "0" ] || return 0
  _marker="${SHARED_DIR}/${SERVICE_MARKER_NAME}"
  [ -f "$_marker" ] || _marker="${PREFIX}/${SERVICE_MARKER_NAME}"
  [ -f "$_marker" ] || return 0
  _u=$(sed -n '1p' "$_marker" 2>/dev/null | tr -d ' \011')
  [ -n "$_u" ] || return 0
  if ! id "$_u" >/dev/null 2>&1; then
    warn "the '${_u}' service account named in ${_marker} is missing; operating as the current user."
    return 0
  fi
  SERVICE_USER="$_u"
  SERVICE_MODE="true"
}

# Fresh root install only: create the account, own the tree, write the marker, and enter
# service mode. No relocation/re-exec: the bootstrap already installed under /opt/afct.
maybe_setup_service_user() {
  [ "$SERVICE_MODE" = "true" ] && return 0
  service_user_enabled || return 0
  [ "$(id -u 2>/dev/null || echo 1)" = "0" ] || return 0

  if can_prompt && [ "$ASSUME_YES" != "true" ]; then
    heading "Dedicated service account"
    info "AFCT can run under a dedicated '${SERVICE_USER}' system account instead of your"
    info "login, so the deploy files and Docker access belong to a purpose-built user."
    if ! confirm "Install under the '${SERVICE_USER}' service account?" "y"; then
      info "Installing as the current user."
      return 0
    fi
  fi

  create_service_user || {
    warn "could not create the '${SERVICE_USER}' account; installing as the current user."
    return 0
  }

  mkdir -p "$SHARED_DIR" 2>/dev/null || true
  printf '%s\n' "$SERVICE_USER" > "${SHARED_DIR}/${SERVICE_MARKER_NAME}" 2>/dev/null || true
  own_service_tree
  SERVICE_MODE="true"
  success "Using the '${SERVICE_USER}' service account (deploy root ${PREFIX})."
}
