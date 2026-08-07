#!/bin/sh
# Resolve the deployment-tool INSTALLER_VERSION recorded at a base git ref.
#
# The CI "bump the deployment version when bundle sources change" check compares the base
# branch's version against HEAD. The controller moved from deploy/linux/bin/afctctl to
# deploy/unix/bin/afctctl in the shared-Unix refactor, so a base ref from before that move
# only has the old path. Try the new path first, then the old one, so a reorg is never
# mistaken for "no previous bundle" (which would silently skip enforcement).
#
# Usage: sh deploy/ci-base-version.sh <base-git-ref>
# Prints the version string, or nothing if no controller existed at that ref.
set -eu

BASE=${1:?usage: ci-base-version.sh <base-git-ref>}

_controller=$(
  git show "${BASE}:deploy/unix/bin/afctctl" 2>/dev/null ||
  git show "${BASE}:deploy/linux/bin/afctctl" 2>/dev/null ||
  true
)

printf '%s\n' "$_controller" |
  sed -n 's/^INSTALLER_VERSION="\(.*\)"/\1/p' |
  head -n 1
