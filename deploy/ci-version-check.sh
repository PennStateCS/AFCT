#!/bin/sh
# Enforce the unified AFCT deployment-tool version.
#
# The version is stored in two controllers that must always agree:
#   deploy/unix/bin/afctctl      INSTALLER_VERSION="X.Y.Z"   (Linux + macOS)
#   deploy/windows/bin/afctctl.ps1  $InstallerVersion = 'X.Y.Z'  (Windows)
#
# Usage:
#   ci-version-check.sh                # agreement only: Unix version == Windows version
#   ci-version-check.sh <base-git-ref> # agreement + require a version bump when any bundle
#                                       # source changed versus <base-ref>
#
# The Windows version is parsed here with sed so this runs in the bats/Alpine container with
# no PowerShell; deploy/ci-windows-version.ps1 is the PowerShell reader CI uses where pwsh is
# available, and the workflow cross-checks that the two agree.
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

read_unix_ver() {
  sed -n 's/^INSTALLER_VERSION="\(.*\)"/\1/p' "$1" 2>/dev/null | head -n1
}
# The '$' in $InstallerVersion is mid-pattern, so sed treats it as a literal dollar sign.
read_win_ver() {
  sed -n "s/^[[:space:]]*\$InstallerVersion[[:space:]]*=[[:space:]]*'\([^']*\)'.*/\1/p" "$1" 2>/dev/null | head -n1
}

UNIX=$(read_unix_ver "$DIR/unix/bin/afctctl")
WIN=$(read_win_ver "$DIR/windows/bin/afctctl.ps1")

[ -n "$UNIX" ] || { echo "::error::could not read the Unix deployment-tool version (deploy/unix/bin/afctctl)."; exit 1; }
[ -n "$WIN" ]  || { echo "::error::could not parse the Windows deployment-tool version (deploy/windows/bin/afctctl.ps1)."; exit 1; }
if [ "$UNIX" != "$WIN" ]; then
  echo "::error::deployment-tool versions differ: Unix=${UNIX} Windows=${WIN}. Keep them unified (bump both)."
  exit 1
fi
echo "deployment-tool version agrees across platforms: ${UNIX}"

BASE=${1:-}
[ -n "$BASE" ] || exit 0

CHANGED=$(git diff --name-only "${BASE}"...HEAD -- \
  deploy/unix \
  deploy/linux \
  deploy/macos \
  deploy/windows \
  deploy/docker-compose.yml \
  deploy/.env.production.example 2>/dev/null || true)

if [ -z "$CHANGED" ]; then
  echo "no bundle-source changes versus ${BASE}; no version bump required."
  exit 0
fi

BASE_VER=$(sh "$DIR/ci-base-version.sh" "$BASE" 2>/dev/null || true)
if [ -z "$BASE_VER" ]; then
  echo "base ${BASE} has no deployment bundle yet; skipping the bump check."
  exit 0
fi

if [ "$BASE_VER" = "$UNIX" ]; then
  echo "::error::bundle sources changed but the deployment-tool version is still ${UNIX}. Bump INSTALLER_VERSION in deploy/unix/bin/afctctl AND \$InstallerVersion in deploy/windows/bin/afctctl.ps1."
  exit 1
fi
echo "deployment-tool version bumped ${BASE_VER} -> ${UNIX}."
