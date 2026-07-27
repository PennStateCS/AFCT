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

  _wrapper="${HOME}/.local/bin/afctctl"
  if [ -f "$_wrapper" ]; then
    rm -f "$_wrapper" 2>/dev/null && info "removed the command wrapper ${_wrapper}."
  fi

  if [ "$NON_INTERACTIVE" = "true" ] || confirm "Remove the tooling directory ${PREFIX}?" "y"; then
    # Guard: only ever remove an AFCT-looking prefix under the user's home.
    case "$PREFIX" in
      "$HOME"/.afct|"$HOME"/.afct/*)
        rm -rf "$PREFIX" 2>/dev/null && info "removed ${PREFIX}." ;;
      *)
        warn "refusing to remove an unexpected prefix (${PREFIX}); remove it by hand if intended." ;;
    esac
  fi

  success "AFCT uninstalled."
  info "Application images remain in Docker Desktop; remove them with:"
  info "  docker image ls | grep afct"
}
