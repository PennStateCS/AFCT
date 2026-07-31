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
# Compose interpolation prefers an exported AFCT_APP_TAG over the value in the env file,
# so a pinned update (AFCT_APP_TAG=vX.Y.Z afctctl update) deploys that tag while the file
# keeps the old pin, and the next plain update would silently redeploy the OLD release.
# After a healthy deploy, record the effective tag back to the env file. The rolling
# "main" is never recorded: pins name published releases only, matching
# pin_release_tag_on_fresh_install.
persist_deployed_app_tag() {
  _deployed=${AFCT_APP_TAG:-}
  [ -n "$_deployed" ] || return 0
  [ "$_deployed" = "$(read_env_value AFCT_APP_TAG "$ENV_FILE")" ] && return 0
  if [ "$_deployed" = "main" ]; then
    warn "deployed the rolling main build without recording it as a pin (pins name published releases only). A plain 'afctctl update' will redeploy the release pinned in ${ENV_FILE}."
    return 0
  fi
  case "$_deployed" in *[!A-Za-z0-9._-]*)
    warn "AFCT_APP_TAG contains unsupported characters; not recording it in ${ENV_FILE}."
    return 0
    ;;
  esac
  set_env_flag AFCT_APP_TAG "$_deployed"
  info "recorded the deployed version (AFCT_APP_TAG=${_deployed}) in ${ENV_FILE}."
}

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
    persist_deployed_app_tag
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
  if platform_updater_experimental; then
    warn "on macOS the in-app updater is EXPERIMENTAL: it has not yet been validated end to end on real Docker Desktop hardware. Prefer 'afctctl update' and 'afctctl self-update' from the command line, and treat in-app upgrades as unproven for now."
  fi
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
    if platform_updater_experimental; then
      warn "On macOS this is EXPERIMENTAL and not yet validated on real Docker Desktop."
    fi
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
# Update the deployment tooling to the newest published bundle named by the deployment
# manifest. Unlike the fresh-install path, an installed system must NOT execute a freshly
# downloaded bootstrap as root: instead this TRUSTED, already-installed afctctl resolves
# the bundle from the validated manifest, downloads it, verifies its SHA-256 itself, and
# then hands the verified LOCAL archive to the already-installed (trusted) bootstrap in
# switch-only mode, which re-verifies, inspects the archive for unsafe paths, extracts,
# validates, switches atomically, keeps the previous release, and rolls back on failure.
do_self_update() {
  acquire_lock
  info "updating the AFCT deployment tooling..."

  _mf=$(mktemp "${TMPDIR:-/tmp}/afct-manifest.XXXXXX") || die "could not create a temporary file."
  if ! fetch_deployment_manifest "$_mf"; then
    rm -f "$_mf"
    die "could not fetch or validate the deployment manifest. Check network access to the release assets."
  fi
  _new_ver=$(manifest_field deploymentToolVersion "$_mf")
  _bundle=$(manifest_field bundle "$_mf")
  _sha=$(manifest_field sha256 "$_mf")
  rm -f "$_mf"

  if ! version_gt "$_new_ver" "$INSTALLER_VERSION"; then
    success "The deployment tooling is already up to date (${INSTALLER_VERSION})."
    return 0
  fi

  _dir=$(mktemp -d "${TMPDIR:-/tmp}/afct-selfupdate.XXXXXX") || die "could not create a temporary directory."
  _arch="${_dir}/${_bundle}"
  info "downloading deployment tooling ${_new_ver} (${_bundle})..."
  if ! fetch_url "$(deployment_asset_base)/${_bundle}" "$_arch" || [ ! -s "$_arch" ]; then
    rm -rf "$_dir"
    die "could not download the deployment bundle ${_bundle}."
  fi
  # Verify the manifest's checksum against the downloaded bytes BEFORE trusting them.
  _actual=$(sha_of "$_arch")
  if [ "$_actual" != "$_sha" ]; then
    rm -rf "$_dir"
    die "deployment bundle checksum mismatch (expected ${_sha}, got ${_actual}); refusing to self-update."
  fi

  # Confirm the manifest names the standard bundle filename for its version, and that the
  # bundle's OWN versions (DEPLOY_VERSION and bundled afctctl INSTALLER_VERSION) agree with
  # the manifest version. Read members to stdout (no filesystem write, so no traversal
  # risk) rather than extracting the untrusted archive here; the trusted bootstrap does the
  # authoritative safe extraction next.
  _exp_bundle=$(manifest_expected_bundle "$_new_ver")
  if [ "$_bundle" != "$_exp_bundle" ]; then
    rm -rf "$_dir"
    die "manifest bundle name ${_bundle} does not match version ${_new_ver} (expected ${_exp_bundle}); refusing to self-update."
  fi
  _members=$(tar -tzf "$_arch" 2>/dev/null)
  _dv_member=$(printf '%s\n' "$_members" | grep -E '(^|/)DEPLOY_VERSION$' | head -n1)
  _iv_member=$(printf '%s\n' "$_members" | grep -E '(^|/)bin/afctctl$' | head -n1)
  _a_dv=$(tar -xzOf "$_arch" "$_dv_member" 2>/dev/null | sed -n '1p' | tr -dc '0-9A-Za-z._-')
  _a_iv=$(tar -xzOf "$_arch" "$_iv_member" 2>/dev/null | sed -n 's/^INSTALLER_VERSION="\(.*\)"/\1/p' | head -n1)
  if [ -z "$_a_dv" ] || [ -z "$_a_iv" ] || [ "$_a_dv" != "$_new_ver" ] || [ "$_a_iv" != "$_new_ver" ]; then
    rm -rf "$_dir"
    die "the downloaded bundle's versions (DEPLOY_VERSION=${_a_dv:-?}, INSTALLER_VERSION=${_a_iv:-?}) do not both match the manifest version ${_new_ver}; refusing to self-update."
  fi

  printf '%s  %s\n' "$_sha" "$_bundle" > "${_arch}.sha256"

  # The installed bootstrap was verified when it was installed; run THAT one (never a
  # freshly downloaded bootstrap) in switch-only mode against the verified local archive.
  _boot="${RELEASE_DIR}/install.sh"
  [ -f "$_boot" ] || { rm -rf "$_dir"; die "the installed bootstrap is missing; cannot self-update safely."; }

  if AFCT_SWITCH_ONLY=1 AFCT_PREFIX="$PREFIX" AFCT_BUNDLE_FILE="$_arch" sh "$_boot"; then
    rm -rf "$_dir"
    success "The AFCT deployment tooling was updated to ${_new_ver}."
    info "Your .env.production and data volumes were not touched."
    info "Apply any new application image or compose changes with: afctctl update"
    return 0
  fi

  rm -rf "$_dir"
  die "the deployment-tool self-update failed; the previous tooling is still active."
}

# Reconstruct the user's original command as a newline-separated argument list (the command
# followed by each flag it was invoked with), so a self-update re-exec preserves the full
# intent, not just the command name. Eval-free and POSIX. Kept as its own function so the
# reconstruction is directly testable and cannot drift from what the re-exec uses.
reexec_argv() {
  printf '%s\n' "$MODE"
  [ "$ASSUME_YES" = "true" ] && printf '%s\n' "--yes"
  [ "$NON_INTERACTIVE" = "true" ] && printf '%s\n' "--non-interactive"
  [ "$FORCE_RECONFIGURE" = "true" ] && printf '%s\n' "--reconfigure"
  [ "$WITH_UPDATER" = "true" ] && printf '%s\n' "--with-updater"
  [ "$COLOR_FORCED_OFF" = "true" ] && printf '%s\n' "--no-color"
  case "$SERVICE_USER_CHOICE" in
    --no-service-user) printf '%s\n' "--no-service-user" ;;
    --service-user=*) printf '%s\n' "$SERVICE_USER_CHOICE" ;;
  esac
  return 0
}

# Before a mutating run, offer to update the deployment tooling when a newer bundle is
# published (learned from the validated deployment manifest, not by parsing shell source).
# Skips when re-executed (AFCT_INSTALLER_SELF_CHECKED), offline, or already up to date.
# Non-interactive without -y: only notes the newer version.
check_deploy_tool_update() {
  [ "${AFCT_INSTALLER_SELF_CHECKED:-}" = "1" ] && return 0
  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || return 0

  _mf=$(mktemp "${TMPDIR:-/tmp}/afct-manifest-check.XXXXXX" 2>/dev/null) || return 0
  if ! fetch_deployment_manifest "$_mf"; then
    rm -f "$_mf"
    return 0
  fi
  _remote_ver=$(manifest_field deploymentToolVersion "$_mf")
  rm -f "$_mf"
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
      info "re-running the updated deployment tool with your original options ..."
      # Rebuild and preserve the FULL original command (every flag, not just the command
      # name), then exec the now-active new afctctl. The guard stops it re-checking in a
      # loop. Splitting reexec_argv on newlines is safe (our flags contain none) and eval
      # free; we exec immediately after.
      set --
      _old_ifs=$IFS
      IFS='
'
      # shellcheck disable=SC2013  # deliberate newline-split of the argv list
      for _a in $(reexec_argv); do set -- "$@" "$_a"; done
      IFS=$_old_ifs
      AFCT_INSTALLER_SELF_CHECKED=1 exec "${PREFIX}/current/bin/afctctl" "$@"
      ;;
    *) return 0 ;;
  esac
}
