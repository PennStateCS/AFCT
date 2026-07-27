#!/bin/sh
# Linux implementation of the small platform abstraction.
#
# The shared deployment modules live in deploy/unix/lib and serve both Linux and macOS.
# The handful of things that genuinely differ between the two are expressed as
# platform_* functions; this file is the Linux side and deploy/macos/lib/platform.sh is
# the macOS side. Every function here reproduces the exact behavior the Linux tooling
# already shipped with, so extracting this seam does not change Linux behavior.
#
# Sourced by afctctl (right after environment.sh, before docker.sh); defines functions
# only, no side effects on source.
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl

platform_name() { printf 'Linux'; }

# The release-asset family prefix for this platform's deployment bundle.
platform_bundle_prefix() { printf 'afct-linux-deploy-'; }

# The release asset holding this platform's deployment manifest (Linux and macOS publish
# separate manifests to the same release so each self-updates against its own bundle).
platform_manifest_asset() { printf 'deployment-manifest.json'; }

# Human-readable OS identity for the diagnostics archive. On Linux the distro details
# live in /etc/os-release; a missing file (unusual) simply contributes nothing.
platform_os_identity() {
  cat /etc/os-release 2>/dev/null || true
}

# A dedicated system service account is a Linux deployment concept (see service-user.sh).
platform_supports_service_user() { return 0; }

# The in-app updater sidecar is supported on Linux.
platform_supports_updater() { return 0; }

# The Linux updater is a shipped, tested feature (not experimental).
platform_updater_experimental() { return 1; }

# Docker on Linux bind-mounts host paths directly (no Docker Desktop file-sharing gate),
# so there is nothing to preflight.
platform_check_bind_mounts() { return 0; }

# macOS-only Docker Desktop resolver. On Linux the inline logic in
# resolve_docker_access (docker.sh) is used instead and this stub is never reached; it
# exists so the shared Darwin branch always resolves to a defined function.
platform_resolve_docker_access() { return 1; }

# Best-effort "open this URL in a browser". Used only for optional convenience prompts.
platform_open_browser() {
  [ -n "${1:-}" ] || return 1
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$1" >/dev/null 2>&1 &
    return 0
  fi
  return 1
}
