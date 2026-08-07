#!/bin/sh
# AFCT Linux installer: compatibility entry point.
#
# The Linux deployment tooling now ships as a small bootstrap plus a versioned bundle
# managed by `afctctl` (see deploy/linux/). This shim keeps existing muscle memory and
# existing installs working:
#
#   * If afctctl is already installed, it forwards the command to it.
#       sh install.sh status   ->   afctctl status
#   * Otherwise it downloads and runs the bootstrap, which installs the versioned bundle
#     under /opt/afct, then runs the command you asked for.
#
# New installs can use the bootstrap directly:
#   curl -fsSLO https://github.com/PennStateCS/AFCT/releases/latest/download/install.sh
#   sudo sh install.sh

set -eu

PREFIX=${AFCT_PREFIX:-/opt/afct}

# The legacy behavior of a bare `sh install.sh` was the guided install / existing-install
# menu, so map "no command" to `install`.
[ "$#" -gt 0 ] || set -- install

# Already migrated to afctctl: forward the command verbatim.
_ctl="${PREFIX}/current/bin/afctctl"
if [ ! -x "$_ctl" ]; then
  _ctl=$(command -v afctctl 2>/dev/null || printf '')
fi
if [ -n "$_ctl" ] && [ -x "$_ctl" ]; then
  exec "$_ctl" "$@"
fi

# Not installed yet: fetch the bootstrap, install ONLY the tooling (no forced `install`),
# then run the ORIGINAL command unchanged. This keeps `sh install.sh status` (or
# logs/doctor/diagnostics/...) working on the very first run, instead of being rewritten
# into `afctctl install status`.
printf '[afct] The AFCT Linux installer now uses afctctl; bootstrapping the versioned deployment bundle...\n'

_url=${AFCT_BOOTSTRAP_URL:-https://github.com/PennStateCS/AFCT/releases/latest/download/install.sh}
_boot=$(mktemp "${TMPDIR:-/tmp}/afct-install.XXXXXX") || { printf '[afct] ERROR: could not create a temporary file.\n' >&2; exit 1; }
if command -v curl >/dev/null 2>&1; then
  curl -fsSL --connect-timeout 10 --max-time 300 --retry 3 --retry-delay 2 "$_url" -o "$_boot" \
    || { rm -f "$_boot"; printf '[afct] ERROR: could not download the installer from %s\n' "$_url" >&2; exit 1; }
elif command -v wget >/dev/null 2>&1; then
  wget -q --timeout=30 --tries=3 -O "$_boot" "$_url" \
    || { rm -f "$_boot"; printf '[afct] ERROR: could not download the installer from %s\n' "$_url" >&2; exit 1; }
else
  rm -f "$_boot"
  printf '[afct] ERROR: curl or wget is required to download the installer.\n' >&2
  exit 1
fi

# Step 1: install the deployment tooling only. AFCT_SWITCH_ONLY places, verifies, and
# switches the versioned release without running `afctctl install`.
AFCT_SWITCH_ONLY=1 sh "$_boot"
_rc=$?
rm -f "$_boot"
[ "$_rc" -eq 0 ] || exit "$_rc"

_ctl="${PREFIX}/current/bin/afctctl"
[ -x "$_ctl" ] || _ctl=$(command -v afctctl 2>/dev/null || printf '')
if [ -z "$_ctl" ] || [ ! -x "$_ctl" ]; then
  printf '[afct] ERROR: the deployment tooling did not install correctly.\n' >&2
  exit 1
fi

# Step 2: run the command the user actually asked for, unchanged (full original argv). Any
# --service-user / --no-service-user flags ride along and are handled by that command.
exec "$_ctl" "$@"
