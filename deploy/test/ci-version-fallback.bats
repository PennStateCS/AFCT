#!/usr/bin/env bats
#
# Proves the CI base-version resolver (deploy/ci-base-version.sh) reads the deployment-tool
# version from the current controller path and falls back to the pre-refactor Linux path,
# so the shared-Unix reorg is never mistaken for "no previous bundle" (which would skip the
# version-bump enforcement).
#
# Run: bats deploy/test/ci-version-fallback.bats

setup() {
  DEPLOY_DIR="$BATS_TEST_DIRNAME/.."
  SCRIPT="$DEPLOY_DIR/ci-base-version.sh"
  R="$(mktemp -d)"
  cd "$R" || return 1
  git init -q
  git config user.email 't@example.com'
  git config user.name 'Test'
  cp "$SCRIPT" ci-base-version.sh
  export DEPLOY_DIR SCRIPT R
}

teardown() {
  [ -n "${R:-}" ] && rm -rf "$R"
}

@test "falls back to the old Linux controller path for a pre-refactor base" {
  mkdir -p deploy/linux/bin
  printf 'INSTALLER_VERSION="2.2.0"\n' > deploy/linux/bin/afctctl
  git add -A && git commit -qm old
  _ref=$(git rev-parse HEAD)
  run sh ci-base-version.sh "$_ref"
  [ "$status" -eq 0 ]
  [ "$output" = "2.2.0" ]
}

@test "prefers the current unix controller path when both exist" {
  mkdir -p deploy/unix/bin deploy/linux/bin
  printf 'INSTALLER_VERSION="2.2.1"\n' > deploy/unix/bin/afctctl
  printf 'INSTALLER_VERSION="2.2.0"\n' > deploy/linux/bin/afctctl
  git add -A && git commit -qm both
  _ref=$(git rev-parse HEAD)
  run sh ci-base-version.sh "$_ref"
  [ "$status" -eq 0 ]
  [ "$output" = "2.2.1" ]
}

@test "prints nothing when no controller exists at the base ref" {
  printf 'readme\n' > README.txt
  git add -A && git commit -qm empty
  _ref=$(git rev-parse HEAD)
  run sh ci-base-version.sh "$_ref"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
