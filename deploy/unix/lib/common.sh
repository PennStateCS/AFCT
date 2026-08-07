#!/bin/sh
# Process lifecycle for afctctl: locking, cleanup, signal handling, downloads, and a
# portable version comparison.
#
# Sourced by afctctl; defines functions only. afctctl installs the traps (so sourcing
# has no side effects) and owns the globals these read/clear (LOCK_*, TMP_*, DIAG_*,
# TTY_ECHO_DISABLED, PULL_OUTPUT, UPDATE_IMAGE_SNAPSHOT, DOCKER_INSTALL_*).
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl

restore_terminal() {
  if [ "${TTY_ECHO_DISABLED:-false}" = "true" ]; then
    stty echo 2>/dev/null || true
    TTY_ECHO_DISABLED="false"
    printf '\n' >&2
  fi
}

release_lock() {
  if [ "${LOCK_HELD:-false}" = "true" ]; then
    rm -rf "$LOCK_DIR" 2>/dev/null || true
    LOCK_HELD="false"
  fi
}

cleanup_temporary_files() {
  [ -n "${TMP_ENV:-}" ] && rm -f "$TMP_ENV" 2>/dev/null || true
  [ -n "${DOCKER_INSTALL_SCRIPT:-}" ] && rm -f "$DOCKER_INSTALL_SCRIPT" 2>/dev/null || true
  [ -n "${DOCKER_INSTALL_OUTPUT:-}" ] && rm -f "$DOCKER_INSTALL_OUTPUT" 2>/dev/null || true
  [ -n "${PULL_OUTPUT:-}" ] && rm -f "$PULL_OUTPUT" 2>/dev/null || true
  [ -n "${UPDATE_IMAGE_SNAPSHOT:-}" ] && rm -f "$UPDATE_IMAGE_SNAPSHOT" 2>/dev/null || true
  [ -n "${DIAG_WORK:-}" ] && rm -rf "$DIAG_WORK" 2>/dev/null || true
}

on_signal() {
  _signal_status=$1
  # A user-initiated interrupt is not a crash: don't auto-collect diagnostics for it.
  DIAG_ON_EXIT="false"
  restore_terminal
  exit "$_signal_status"
}

on_exit() {
  _status=$?
  trap - 0
  restore_terminal
  release_lock

  if [ "$_status" -ne 0 ] && [ "${DIAG_ON_EXIT:-false}" = "true" ] && \
     [ "${DIAG_IN_PROGRESS:-false}" != "true" ]; then
    DIAG_IN_PROGRESS="true"
    error "operation failed with exit status ${_status}; creating a support archive..."
    collect_diagnostics "automatic" || true
  fi

  cleanup_temporary_files
  exit "$_status"
}

# Install the process-lifetime traps. Called by afctctl (never on source) so a plain
# `sh -n`/sourcing of the library has no side effects.
install_traps() {
  trap 'on_signal 130' INT
  trap 'on_signal 143' TERM
  trap 'on_signal 129' HUP
  trap 'on_exit' 0
}

acquire_lock() {
  # Reentrant within a single run: a command reached from the interactive menu (for
  # example "update") must not deadlock against the lock this process holds.
  [ "${LOCK_HELD:-false}" = "true" ] && return 0

  if mkdir "$LOCK_DIR" 2>/dev/null; then
    LOCK_HELD="true"
    printf '%s\n' "$$" > "$LOCK_DIR/pid" 2>/dev/null || true
    return 0
  fi

  _lock_pid=""
  [ -f "$LOCK_DIR/pid" ] && _lock_pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  case "$_lock_pid" in
    ''|*[!0-9]*) ;;
    *)
      if kill -0 "$_lock_pid" 2>/dev/null; then
        die "another AFCT installer operation is already running (PID ${_lock_pid})."
      fi
      ;;
  esac

  warn "removing a stale installer lock."
  rm -rf "$LOCK_DIR" 2>/dev/null || die "could not remove the stale lock at ${LOCK_DIR}."
  mkdir "$LOCK_DIR" 2>/dev/null || die "could not acquire the installer lock at ${LOCK_DIR}."
  LOCK_HELD="true"
  printf '%s\n' "$$" > "$LOCK_DIR/pid" 2>/dev/null || true
}

# Download a URL to a file with curl or wget (whichever is present). Non-zero on
# failure. Bounded timeouts + a few retries so a slow or flaky network fails
# predictably instead of hanging.
fetch_url() {
  _url=$1
  _dest=$2
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --connect-timeout 10 --max-time 120 --retry 3 --retry-delay 2 "$_url" -o "$_dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --timeout=30 --tries=3 -O "$_dest" "$_url"
  else
    die "curl or wget is required to download files."
  fi
}

canonical_path() {
  if command -v realpath >/dev/null 2>&1; then
    realpath "$1" 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

# SHA-256 of a file (first field only), or nothing if the file is absent or no tool is
# available. Used to tell an afctctl-written runtime Compose file from an updater-edited
# one, so a tooling refresh never clobbers an applied stack-layout change.
sha_of() {
  [ -f "$1" ] || return 0
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | awk '{ print $1; exit }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" 2>/dev/null | awk '{ print $1; exit }'
  fi
}

# True when dotted-numeric version $1 is strictly newer than $2 (field by field, so
# 2.1.10 > 2.1.9). If either version isn't purely digits-and-dots, fall back to a plain
# inequality so an unusual scheme still offers an update rather than getting stuck.
# Portable: no `sort -V`, which busybox/older shells may lack.
version_gt() {
  _va=$1
  _vb=$2
  case "$_va$_vb" in
    *[!0-9.]*) [ "$_va" != "$_vb" ]; return $? ;;
  esac
  while [ -n "$_va" ] || [ -n "$_vb" ]; do
    _fa=${_va%%.*}
    _fb=${_vb%%.*}
    [ -n "$_fa" ] || _fa=0
    [ -n "$_fb" ] || _fb=0
    [ "$_fa" -gt "$_fb" ] && return 0
    [ "$_fa" -lt "$_fb" ] && return 1
    case "$_va" in *.*) _va=${_va#*.} ;; *) _va="" ;; esac
    case "$_vb" in *.*) _vb=${_vb#*.} ;; *) _vb="" ;; esac
  done
  return 1
}
