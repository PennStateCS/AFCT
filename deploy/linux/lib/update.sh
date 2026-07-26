#!/bin/sh
# Application updates + rollback, the updater sidecar, application-version pinning, and
# the bundle-based deployment-tool self-update.
#
# Two different "versions" live here and are kept distinct in the output:
#   * the APPLICATION image version (AFCT_APP_TAG, e.g. v0.1.4), pulled/rolled back below.
#   * the DEPLOYMENT-TOOL version (INSTALLER_VERSION, e.g. 2.2.0), updated by self-update
#     as a whole verified bundle.
#
# Sourced by afctctl; defines functions only. Reads globals set by afctctl (ENV_FILE,
# UPDATER_SERVICE, INSTALLER_BASE_URL, INSTALLER_VERSION, REPO, PREFIX, LOG_FILE, MODE,
# ASSUME_YES). Delegates the verified bundle install/switch to the newest bootstrap.
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl

# --------------------------------------------------------------------------- #
# Application-version pinning (uses the app release manifest, versions.json)
# --------------------------------------------------------------------------- #
list_release_tags() {
  _vf=$(mktemp "${TMPDIR:-/tmp}/afct-versions.XXXXXX" 2>/dev/null) || return 0
  if fetch_url "${INSTALLER_BASE_URL}/versions.json" "$_vf" 2>/dev/null && [ -s "$_vf" ]; then
    if command -v jq >/dev/null 2>&1; then
      jq -r '(.versions // [])[]?.tag // empty' "$_vf" 2>/dev/null | grep -v '^main$' || true
    else
      awk '
        {
          s = $0
          while (match(s, /"tag"[ \t]*:[ \t]*"[^"]*"/)) {
            tok = substr(s, RSTART, RLENGTH)
            s = substr(s, RSTART + RLENGTH)
            sub(/^"tag"[ \t]*:[ \t]*"/, "", tok)
            sub(/"$/, "", tok)
            if (tok != "" && tok != "main") print tok
          }
        }
      ' "$_vf"
    fi
  fi
  rm -f "$_vf"
}

# On a brand-new install, pin AFCT_APP_TAG to a published RELEASE (never the rolling
# "main"). An explicit AFCT_APP_TAG is honored only if it names a real release; with none
# set we take the newest. If no release can be determined the install stops rather than
# silently deploying "main". An existing release pin is left alone.
pin_release_tag_on_fresh_install() {
  _existing=$(read_env_value AFCT_APP_TAG "$ENV_FILE")
  if [ -n "$_existing" ] && [ "$_existing" != "main" ]; then
    return 0
  fi

  _want=${AFCT_APP_TAG:-}
  if [ "$_want" = "main" ]; then
    die "AFCT_APP_TAG=main is not allowed: the installer deploys published releases only. Set AFCT_APP_TAG to a release (for example v0.1.1), or leave it unset to install the latest."
  fi

  _releases=$(list_release_tags)
  if [ -n "$_want" ]; then
    case "$_want" in *[!A-Za-z0-9._-]*) die "AFCT_APP_TAG contains unsupported characters." ;; esac
    if [ -n "$_releases" ] && ! printf '%s\n' "$_releases" | grep -qxF "$_want"; then
      die "AFCT_APP_TAG='${_want}' is not a published release. Known releases: $(printf '%s\n' "$_releases" | tr '\n' ' ')."
    fi
    _tag=$_want
  else
    _tag=$(printf '%s\n' "$_releases" | head -n 1)
    [ -n "$_tag" ] || die "could not determine the latest release to install (is ${INSTALLER_BASE_URL}/versions.json reachable?). Re-run with AFCT_APP_TAG=vX.Y.Z to pin a specific release."
  fi

  set_env_flag AFCT_APP_TAG "$_tag"
  info "pinned this install to release ${_tag}. Change it later from Admin -> System Settings -> Updates."
}

# --------------------------------------------------------------------------- #
# Application update + rollback
# --------------------------------------------------------------------------- #
do_update() {
  acquire_lock
  prepare_existing_stack
  DIAG_ON_EXIT="true"
  info "updating AFCT to the latest published images..."

  validate_compose
  # Before anything is downloaded, so a short disk stops the update while the running
  # version is still untouched.
  require_update_disk_space
  capture_running_images
  pull_images

  if ( start_stack; wait_for_health ); then
    success "AFCT update completed."
    prune_superseded_images || true
    DIAG_ON_EXIT="false"
    return 0
  fi

  error "the newly downloaded AFCT version did not pass its health check."
  collect_diagnostics "failed-update-before-rollback" || true
  DIAG_ON_EXIT="false"

  if rollback_update_images; then
    warn "the update failed, but AFCT was returned to the previously deployed images."
    return 1
  fi

  die "the update failed and automatic rollback was unsuccessful. Review the diagnostics archive."
}

# --------------------------------------------------------------------------- #
# Updater sidecar (privileged in-app updater)
# --------------------------------------------------------------------------- #
start_updater() {
  set_env_flag AFCT_UPDATER_ENABLED true
  info "downloading the updater image..."
  if [ -t 1 ] || [ "${LOG_ENABLED:-false}" != "true" ]; then
    compose_project pull "$UPDATER_SERVICE" || return 1
  else
    compose_project pull "$UPDATER_SERVICE" >> "$LOG_FILE" 2>&1 || return 1
  fi
  info "starting the updater..."
  if [ "${LOG_ENABLED:-false}" = "true" ]; then
    compose_project up -d "$UPDATER_SERVICE" >> "$LOG_FILE" 2>&1 || return 1
  else
    compose_project up -d "$UPDATER_SERVICE" || return 1
  fi
  return 0
}

do_enable_updater() {
  acquire_lock
  prepare_existing_stack

  heading "Enabling the in-app updater"
  warn "the updater container holds the Docker socket, which is root-equivalent on this host. Enable it only if you want to run upgrades and downgrades from Admin -> System Settings."
  if ! confirm "Enable the in-app updater now?" "y"; then
    die "left the updater disabled."
  fi

  DIAG_ON_EXIT="true"
  if ! start_updater; then
    # start_updater flips the flag on before pulling; clear it on failure or every later
    # compose command keeps '--profile updater' and fails on the unavailable image.
    set_env_flag AFCT_UPDATER_ENABLED false
    die "could not pull or start the updater image. If this repository's afct-updater package is private, make it public or run 'docker login ghcr.io'. See ${LOG_FILE}."
  fi
  DIAG_ON_EXIT="false"
  success "in-app updater enabled. Manage versions in Admin -> System Settings -> Updates."
}

maybe_enable_updater_at_install() {
  [ "$(read_env_value AFCT_UPDATER_ENABLED "$ENV_FILE" 2>/dev/null)" = "true" ] && return 0

  if [ "$WITH_UPDATER" != "true" ]; then
    can_prompt || return 0
    heading "Optional: in-app updater"
    info "The updater sidecar lets admins upgrade and downgrade AFCT from"
    info "System Settings. It holds the Docker socket (root-equivalent on this host),"
    info "so it is off unless you turn it on."
    confirm "Enable the in-app updater now?" "n" || {
      info "skipped. Enable it later with: afctctl enable-updater"
      return 0
    }
  fi

  if start_updater; then
    success "in-app updater enabled."
  else
    set_env_flag AFCT_UPDATER_ENABLED false
    warn "could not start the updater (the afct-updater image may be private or unpublished). The rest of AFCT is running; enable it later with: afctctl enable-updater"
  fi
}

do_disable_updater() {
  acquire_lock
  prepare_existing_stack
  info "disabling the in-app updater..."
  compose_project rm -sf "$UPDATER_SERVICE" >/dev/null 2>&1 || true
  set_env_flag AFCT_UPDATER_ENABLED false
  success "in-app updater disabled and its container removed."
}

# --------------------------------------------------------------------------- #
# Deployment-tool self-update (whole verified bundle)
# --------------------------------------------------------------------------- #
# The URL of the newest deployment bootstrap. A fork/mirror overrides it; otherwise it is
# the install.sh asset on the latest GitHub release.
bootstrap_url() {
  printf '%s' "${AFCT_BOOTSTRAP_URL:-https://github.com/${REPO}/releases/latest/download/install.sh}"
}

# Update the deployment tooling to the newest published bundle. The heavy lifting
# (download, checksum verify, path-traversal inspection, staged extract, atomic release
# switch, lightweight validation, rollback, retention) is done by the NEWEST bootstrap in
# switch-only mode, so there is exactly one verified-install implementation to trust.
do_self_update() {
  acquire_lock
  info "updating the AFCT deployment tooling..."

  _boot=$(mktemp "${TMPDIR:-/tmp}/afct-bootstrap.XXXXXX") || die "could not create a temporary file."
  if ! fetch_url "$(bootstrap_url)" "$_boot" || [ ! -s "$_boot" ]; then
    rm -f "$_boot"
    die "could not download the deployment bootstrap. Check network access to the release assets."
  fi
  if ! sh -n "$_boot" 2>/dev/null; then
    rm -f "$_boot"
    die "the downloaded deployment bootstrap is invalid; keeping the current tooling."
  fi

  # Switch-only: verify + extract + atomically switch the active release + validate +
  # keep the previous release for rollback. It does NOT run `afctctl install`.
  if AFCT_SWITCH_ONLY=1 AFCT_PREFIX="$PREFIX" sh "$_boot"; then
    rm -f "$_boot"
    success "The AFCT deployment tooling was updated."
    info "Your .env.production and data volumes were not touched."
    info "Apply any new application image or compose changes with: afctctl update"
    return 0
  fi

  rm -f "$_boot"
  die "the deployment-tool self-update failed; the previous tooling is still active."
}

# Before a mutating run, offer to update the deployment tooling when a newer bundle is
# published. Skips when re-executed (AFCT_INSTALLER_SELF_CHECKED), offline, or already up
# to date. Non-interactive: only notes the newer version (auto-update needs -y).
check_deploy_tool_update() {
  [ "${AFCT_INSTALLER_SELF_CHECKED:-}" = "1" ] && return 0
  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || return 0

  _rf=$(mktemp "${TMPDIR:-/tmp}/afct-bootstrap-check.XXXXXX" 2>/dev/null) || return 0
  if ! fetch_url "$(bootstrap_url)" "$_rf" 2>/dev/null || [ ! -s "$_rf" ]; then
    rm -f "$_rf"
    return 0
  fi
  _remote_ver=$(sed -n 's/^INSTALLER_VERSION="\(.*\)"/\1/p' "$_rf" | head -n 1)
  rm -f "$_rf"
  [ -n "$_remote_ver" ] || return 0
  # Only when strictly newer, so a stale/rolled-back remote can't trigger a downgrade.
  version_gt "$_remote_ver" "$INSTALLER_VERSION" || return 0

  info "a newer deployment tool (${_remote_ver}) is available; you have ${INSTALLER_VERSION}."
  if [ "$ASSUME_YES" = "true" ]; then
    _answer="y"
  elif can_prompt; then
    _answer=$(prompt_default "Update the deployment tool before continuing?" "y")
  else
    info "run 'afctctl self-update' to update the deployment tooling first."
    return 0
  fi
  case "$_answer" in
    y | Y | yes | YES)
      info "updating the deployment tool to ${_remote_ver} ..."
      if ! do_self_update; then
        info "self-update failed; continuing with ${INSTALLER_VERSION}."
        return 0
      fi
      # do_self_update took the lock; release it before re-exec so the fresh run can
      # acquire it (exec keeps this PID, so a held lock looks like a concurrent op).
      release_lock
      info "re-running with the updated deployment tool ..."
      # The guard stops the fresh tooling from checking again in a loop. The active
      # release now points at the new bundle, so run its afctctl.
      AFCT_INSTALLER_SELF_CHECKED=1 exec "${PREFIX}/current/bin/afctctl" "$MODE"
      ;;
    *) return 0 ;;
  esac
}
