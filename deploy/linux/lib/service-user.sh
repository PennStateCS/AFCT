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

# Give the /opt/afct tree to the service account AND set an explicit, safe permission model
# so a preserved or freshly created account can operate the deployment immediately. The
# bootstrap runs with umask 077, so without this the tree is root-owned and 0700, which the
# non-root service account cannot traverse. Ownership is recursive; modes are set per path
# so sensitive files are never widened by a blanket chmod.
#
#   /opt/afct                      0755  (traverse into releases/current/shared)
#   /opt/afct/releases             0755
#   /opt/afct/releases/<rel>       dirs 0755, bin/afctctl 0755 (readable + executable)
#   /opt/afct/current              symlink (mode not meaningful)
#   /opt/afct/shared               0700  (private to the service account)
#   /opt/afct/shared/runtime       0700
#   /opt/afct/shared/backups       0700
#   .env.production / deploy.state / install.log / manifest / marker / runtime compose  0600
own_service_tree() {
  [ "$(id -u 2>/dev/null || echo 1)" = "0" ] || return 0
  service_user_enabled || return 0
  _grp=$(service_user_group)

  chown -R "$SERVICE_USER:$_grp" "$PREFIX" 2>/dev/null || true

  chmod 0755 "$PREFIX" 2>/dev/null || true
  [ -d "${PREFIX}/releases" ] && chmod 0755 "${PREFIX}/releases" 2>/dev/null || true
  for _rel in "${PREFIX}/releases"/*/; do
    [ -d "$_rel" ] || continue
    find "$_rel" -type d -exec chmod 0755 {} + 2>/dev/null || true
    [ -f "${_rel}bin/afctctl" ] && chmod 0755 "${_rel}bin/afctctl" 2>/dev/null || true
  done

  [ -d "$SHARED_DIR" ] && chmod 0700 "$SHARED_DIR" 2>/dev/null || true
  [ -d "${SHARED_DIR}/runtime" ] && chmod 0700 "${SHARED_DIR}/runtime" 2>/dev/null || true
  [ -d "${SHARED_DIR}/backups" ] && chmod 0700 "${SHARED_DIR}/backups" 2>/dev/null || true
  # Sensitive files stay 0600 (never widened). These live under shared/ (0700), so the
  # account is the only non-root reader in any case.
  for _f in "$ENV_FILE" "$(state_file)" "$LOG_FILE" "$(manifest_cache_file)" \
            "${SHARED_DIR}/${SERVICE_MARKER_NAME}" "${SHARED_DIR}/runtime/docker-compose.yml"; do
    [ -f "$_f" ] && chmod 0600 "$_f" 2>/dev/null || true
  done
}

# Atomically persist the service-account marker (one validated username line, mode 0600,
# owned by the account) under the shared directory. The marker is durable deployment state,
# so this is a hard failure when service mode is expected, never best-effort. This is the
# ONLY place a marker is written, so there is one implementation across all callers.
write_service_marker() {
  _user=$1
  case "$_user" in
    ''|*[!a-z0-9._-]*) die "refusing to write a service marker for an invalid username '${_user}'." ;;
  esac
  mkdir -p "$SHARED_DIR" 2>/dev/null || die "could not create ${SHARED_DIR} for the service marker."
  _marker="${SHARED_DIR}/${SERVICE_MARKER_NAME}"
  _tmp=$(mktemp "${_marker}.XXXXXX" 2>/dev/null) || die "could not stage the service marker."
  printf '%s\n' "$_user" > "$_tmp" || { rm -f "$_tmp"; die "could not write the service marker."; }
  chmod 600 "$_tmp" 2>/dev/null || true
  if [ "$(id -u 2>/dev/null || echo 1)" = "0" ] && id "$_user" >/dev/null 2>&1; then
    chown "$_user:$(id -gn "$_user" 2>/dev/null || printf '%s' "$_user")" "$_tmp" 2>/dev/null || true
  fi
  mv "$_tmp" "$_marker" || { rm -f "$_tmp"; die "could not install the service marker at ${_marker}."; }
  _rb=$(sed -n '1p' "$_marker" 2>/dev/null | tr -d ' \011')
  [ "$_rb" = "$_user" ] || die "service marker verification failed after writing ${_marker}."
}

# Remove a stale shared marker. Only called when current-user mode is EXPLICITLY selected
# (--no-service-user), so an accidental run never silently drops service mode.
remove_service_marker() {
  _marker="${SHARED_DIR}/${SERVICE_MARKER_NAME}"
  [ -f "$_marker" ] || return 0
  rm -f "$_marker" 2>/dev/null || die "could not remove the stale service marker ${_marker}."
}

# Confirm the service account can traverse the deployment tree and read the files it needs,
# after ownership has been applied. Best-effort where a real user switch is unavailable
# (returns 0), but a definitive failure returns non-zero so the caller can warn or abort.
verify_service_access() {
  service_user_enabled || return 0
  [ "$(id -u 2>/dev/null || echo 1)" = "0" ] || return 0
  id "$SERVICE_USER" >/dev/null 2>&1 || return 1
  # Traverse to and read the active controller as the service account.
  if [ -e "${PREFIX}/current/bin/afctctl" ]; then
    run_as_service test -r "${PREFIX}/current/bin/afctctl" >/dev/null 2>&1 || return 1
  fi
  # Read the shared configuration when present.
  if [ -f "$ENV_FILE" ]; then
    run_as_service test -r "$ENV_FILE" >/dev/null 2>&1 || return 1
  fi
  return 0
}

# Re-enter service mode on a later run when this deployment is service-account managed.
# The marker lives in the shared directory. Root only: a non-root run can't act as the account.
activate_service_mode_from_marker() {
  [ "$(id -u 2>/dev/null || echo 1)" = "0" ] || return 0
  _marker="${SHARED_DIR}/${SERVICE_MARKER_NAME}"
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

# Decide the service-account mode for an install. Order of precedence:
#   1. An explicit command-line choice (--service-user NAME / --no-service-user) always wins.
#   2. An already service-managed deployment (marker activated at startup): reapply ownership.
#   3. A completed install with no marker: keep current-user mode.
#   4. A genuinely fresh install: offer/create the default dedicated account.
# This runs BEFORE any account is created.
preserve_or_setup_service_account() {
  # 1) An explicit command-line choice always wins, even over an active marker.
  case "${SERVICE_USER_CHOICE:-}" in
    --no-service-user)
      # Explicit current-user mode: drop a stale shared marker (clearly intended) so later
      # runs do not re-enter service mode, and never create the default account.
      remove_service_marker
      SERVICE_MODE="false"
      SERVICE_USER=""
      return 0
      ;;
    --service-user=*)
      # Explicit account: create or preserve exactly this one (even converting a legacy
      # current-user install). maybe_setup_service_user writes the marker and owns the tree.
      maybe_setup_service_user
      return 0
      ;;
  esac

  # No explicit choice. If already service-managed (marker activated at startup), just
  # (re)apply ownership so a preserved account can operate immediately, then stop.
  if [ "$SERVICE_MODE" = "true" ]; then
    write_service_marker "$SERVICE_USER"
    own_service_tree
    return 0
  fi
  # A completed install with no explicit choice and no active marker: current-user mode.
  [ -f "$ENV_FILE" ] && return 0

  # A genuinely fresh install: the normal dedicated-account offer.
  maybe_setup_service_user
}

# Fresh root install (or explicit --service-user conversion): create the account, own the
# tree, write the marker, verify access, and enter service mode. No relocation/re-exec: the
# bootstrap already installed under /opt/afct.
maybe_setup_service_user() {
  service_user_enabled || return 0
  [ "$(id -u 2>/dev/null || echo 1)" = "0" ] || return 0

  # Prompt only for a genuinely fresh install with no explicit choice.
  if [ "${SERVICE_USER_CHOICE:-}" = "" ] && can_prompt && [ "$ASSUME_YES" != "true" ]; then
    heading "Dedicated service account"
    info "AFCT can run under a dedicated '${SERVICE_USER}' system account instead of your"
    info "login, so the deploy files and Docker access belong to a purpose-built user."
    if ! confirm "Install under the '${SERVICE_USER}' service account?" "y"; then
      info "Installing as the current user."
      SERVICE_USER=""
      return 0
    fi
  fi

  create_service_user || {
    warn "could not create the '${SERVICE_USER}' account; installing as the current user."
    SERVICE_USER=""
    return 0
  }

  write_service_marker "$SERVICE_USER"
  own_service_tree
  SERVICE_MODE="true"
  verify_service_access || warn "the '${SERVICE_USER}' service account cannot fully access ${PREFIX} yet; check permissions under ${PREFIX}."
  success "Using the '${SERVICE_USER}' service account (deploy root ${PREFIX})."
}
