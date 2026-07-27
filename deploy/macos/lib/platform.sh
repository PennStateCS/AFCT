#!/bin/sh
# macOS implementation of the small platform abstraction.
#
# The shared deployment modules live in deploy/unix/lib and serve both Linux and macOS.
# This file supplies the macOS side of the platform_* seam (the Linux side is
# deploy/linux/lib/platform.sh). macOS runs AFCT through Docker Desktop as the current
# user: no service account, no sudo, no systemd, no Docker unix group.
#
# Sourced by afctctl (right after environment.sh, before docker.sh); defines functions
# only, no side effects on source.
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl

platform_name() { printf 'macOS'; }

# The release-asset family prefix for this platform's deployment bundle.
platform_bundle_prefix() { printf 'afct-macos-deploy-'; }

# The release asset holding this platform's deployment manifest (distinct from the Linux
# one so a macOS host self-updates against the macOS bundle).
platform_manifest_asset() { printf 'deployment-manifest-macos.json'; }

# Human-readable OS identity for the diagnostics archive. macOS has no /etc/os-release;
# sw_vers is the canonical product/version reporter.
platform_os_identity() {
  if command -v sw_vers >/dev/null 2>&1; then
    sw_vers 2>/dev/null || true
  fi
}

# macOS has no dedicated-service-account model; AFCT runs as the current user.
platform_supports_service_user() { return 1; }

# The in-app updater sidecar can run through Docker Desktop's Docker socket. It stays off
# by default and prints the socket-access warning when enabled.
platform_supports_updater() { return 0; }

# The macOS updater path (Docker socket, host bind mounts, runtime Compose replacement,
# self-recreation through Docker Desktop) is not yet validated on real Mac hardware, so it
# is offered but flagged EXPERIMENTAL. The enable flow, help, install output, and docs all
# say so; it is never presented as fully supported and never silently disabled.
platform_updater_experimental() { return 0; }

# Resolve Docker access on macOS. Docker Desktop exposes the daemon to the logged-in user
# with no sudo, so the Linux escalation path in resolve_docker_access does not apply; this
# is invoked from that function's Darwin branch. It distinguishes the three states the
# operator actually hits: not installed, installed-but-not-running, and Compose missing.
platform_resolve_docker_access() {
  if ! command -v docker >/dev/null 2>&1; then
    error "Docker Desktop is not installed."
    info "Install Docker Desktop, start it, then rerun:"
    info "  - Homebrew:  brew install --cask docker"
    info "  - Or download it from https://www.docker.com/products/docker-desktop/"
    die "Docker Desktop is required."
  fi
  if ! docker info >/dev/null 2>&1; then
    error "Docker Desktop is installed but not running."
    info "Open Docker Desktop and wait until it reports that Docker is running, then rerun."
    die "Docker Desktop is not running."
  fi
  DOCKER_SUDO=""
  detect_compose || die "Docker Compose v2 is unavailable. Your Docker Desktop install may be incomplete or outdated; update Docker Desktop."
  if [ "$COMPOSE_KIND" = "v1" ]; then
    die "Only the legacy docker-compose v1 was found. Update Docker Desktop to get Compose v2 ('docker compose')."
  fi
  return 0
}

# Verify Docker Desktop can bind-mount the host directories the stack needs, before we try
# to start it. The default prefix under $HOME is normally shared, but a custom prefix may
# sit outside Docker Desktop's file-sharing paths and would otherwise fail with a confusing
# mount error at `up` time. Skipped when Docker is mocked for tests
# (AFCT_SKIP_BIND_MOUNT_CHECK=1). Uses the shared docker wrapper and a tiny image.
# Pull the bind-check image, sending Docker's (noisy, non-secret) output to the installer
# log when one is configured and discarding it otherwise, so the terminal stays readable.
_bind_check_pull() {
  if [ -n "${LOG_FILE:-}" ]; then
    docker_cmd pull "$1" >> "$LOG_FILE" 2>&1
  else
    docker_cmd pull "$1" >/dev/null 2>&1
  fi
}

platform_check_bind_mounts() {
  [ "${AFCT_SKIP_BIND_MOUNT_CHECK:-}" = "1" ] && return 0
  _img=${AFCT_BIND_CHECK_IMAGE:-alpine:3.20}

  # Step 1: make sure the test image is available. A pull failure is a network/registry
  # problem (no internet, registry down, rate limit/auth, missing architecture, ...), NOT a
  # file-sharing problem, so it gets its own message and never mentions file sharing.
  if ! docker_cmd image inspect "$_img" >/dev/null 2>&1; then
    info "downloading the small image used to test Docker Desktop file sharing (${_img})..."
    if ! _bind_check_pull "$_img"; then
      error "Docker Desktop could not download the small image used for the file-sharing test (${_img})."
      info "Check your internet connection and Docker registry access, then rerun the installer."
      die "could not download the bind-mount test image."
    fi
  fi

  # Step 2: the image is present. Now verify Docker Desktop can bind-mount each required
  # host directory. A failure here IS a file-sharing problem.
  for _dir in "$SHARED_DIR" "$RUNTIME_DIR"; do
    [ -d "$_dir" ] || continue
    if ! docker_cmd run --rm -v "${_dir}:/afct-bind-check:ro" "$_img" test -d /afct-bind-check >/dev/null 2>&1; then
      error "Docker Desktop cannot access the installation directory: ${_dir}"
      info "Docker Desktop can only bind-mount host paths on its file-sharing list."
      info "Fix this one of two ways:"
      info "  - add the directory under Docker Desktop > Settings > Resources > File sharing, or"
      info "  - reinstall using the default prefix (\$HOME/.afct), which is already shared."
      die "the selected installation directory is not available to Docker Desktop."
    fi
  done
  return 0
}

# Open a URL in the default browser (best effort). Used for optional convenience only.
platform_open_browser() {
  [ -n "${1:-}" ] || return 1
  command -v open >/dev/null 2>&1 || return 1
  open "$1" >/dev/null 2>&1 &
  return 0
}

# --------------------------------------------------------------------------- #
# macOS-only `afctctl uninstall`.
#
# Removes the tooling and containers. Data (the database and uploaded files, which live in
# named Docker volumes) is PRESERVED unless the operator explicitly opts in, either by
# answering the confirmation or by setting AFCT_PURGE_DATA=1 for a non-interactive run.
# --------------------------------------------------------------------------- #
# Decide whether `afctctl uninstall` may delete PREFIX. Removing a directory tree is
# irreversible, so this is deliberately strict: the install-prefix marker must exist and
# record exactly this prefix, the AFCT release layout must be present, and the prefix must
# not be root, a home directory, or an otherwise shallow/dangerous path. A custom prefix
# from `--prefix` is removable, but only when all of these hold.
uninstall_prefix_is_safe() {
  _p=$1

  # Must be absolute and at least two path segments deep (reject "/", "/usr", ...).
  case "$_p" in
    /*) ;;
    *) return 1 ;;
  esac
  _rest=${_p#/}
  case "$_rest" in
    */*) ;;
    *) return 1 ;;
  esac
  # Never a root or home-ish directory.
  case "$_p" in
    ""|"/"|"$HOME"|"$HOME/"|"$HOME/.local"|"$HOME/.local/") return 1 ;;
  esac

  # The marker must exist and record exactly this prefix (canonical match).
  _m="${_p}/shared/install-prefix"
  [ -f "$_m" ] || return 1
  _recorded=$(sed -n '1p' "$_m" 2>/dev/null)
  [ -n "$_recorded" ] && [ "$_recorded" = "$_p" ] || return 1

  # The expected AFCT release structure must be present.
  [ -L "${_p}/current" ] || return 1
  [ -d "${_p}/releases" ] || return 1
  [ -d "${_p}/shared" ] || return 1
  return 0
}

do_uninstall() {
  heading "Uninstall AFCT (macOS)"
  info "This removes the AFCT tooling and containers from this Mac. Your data (the database"
  info "and uploaded files, stored in Docker volumes) is PRESERVED unless you choose to delete it."

  if resolve_docker_access_soft && [ -f "$COMPOSE_FILE" ]; then
    _purge="${AFCT_PURGE_DATA:-}"
    if [ "$NON_INTERACTIVE" != "true" ] && [ -z "$_purge" ]; then
      confirm "Also DELETE the database and uploaded files (Docker volumes)? This is irreversible" "n" && _purge=1
    fi
    if [ "$_purge" = "1" ]; then
      warn "stopping AFCT and removing its data volumes (irreversible)..."
      compose_project down -v 2>/dev/null || true
    else
      info "stopping AFCT containers (keeping data volumes)..."
      compose_project down 2>/dev/null || true
    fi
  else
    warn "Docker Desktop is not running, or no stack is configured; skipping container removal."
    warn "Start Docker Desktop and rerun 'afctctl uninstall' if you still need containers removed."
  fi

  # Remove the user command wrapper ONLY when it belongs to this installation: either the
  # generated wrapper whose exec line targets this prefix, or a symlink that resolves
  # exactly to this prefix's controller. A wrapper pointing elsewhere (another AFCT prefix,
  # a hand-managed command, or an unrelated program with the same name) is left untouched.
  _wrapper="${HOME}/.local/bin/afctctl"
  _wrapper_target="${PREFIX}/current/bin/afctctl"
  _expected_line="exec \"${_wrapper_target}\" \"\$@\""
  if [ -L "$_wrapper" ]; then
    _link=$(readlink "$_wrapper" 2>/dev/null || true)
    case "$_link" in
      /*) _link_abs=$_link ;;
      *)  _link_abs="$(dirname "$_wrapper")/$_link" ;;
    esac
    if [ "$_link_abs" = "$_wrapper_target" ]; then
      rm -f "$_wrapper" 2>/dev/null && info "removed the command wrapper ${_wrapper}."
    else
      warn "left ${_wrapper} in place: it is a symlink to ${_link}, not this installation."
    fi
  elif [ -f "$_wrapper" ]; then
    if grep -qxF "$_expected_line" "$_wrapper" 2>/dev/null; then
      rm -f "$_wrapper" 2>/dev/null && info "removed the command wrapper ${_wrapper}."
    else
      warn "left ${_wrapper} in place: it does not point to this installation (${PREFIX})."
    fi
  fi

  if [ "$NON_INTERACTIVE" = "true" ] || confirm "Remove the tooling directory ${PREFIX}?" "y"; then
    if uninstall_prefix_is_safe "$PREFIX"; then
      rm -rf "$PREFIX" 2>/dev/null && info "removed ${PREFIX}."
    else
      warn "not removing ${PREFIX} automatically: it does not look like an AFCT install created"
      warn "by this installer (missing or mismatched ${PREFIX}/shared/install-prefix marker, or an"
      warn "unexpected layout). This guards against deleting the wrong directory."
      info "If you are sure, remove it by hand, for example:"
      info "  rm -rf \"${PREFIX}\""
    fi
  fi

  success "AFCT uninstalled."
  info "Application images remain in Docker Desktop; remove them with:"
  info "  docker image ls | grep afct"
}
