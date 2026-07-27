#!/usr/bin/env bats
#
# Proves deploy/ci-version-check.sh enforces (1) that the Unix and Windows deployment-tool
# versions agree, and (2) that a change to any bundle source is accompanied by a version
# bump. The Windows version is parsed with sed here (the bats/Alpine container has no
# PowerShell); deploy/ci-windows-version.ps1 is the PowerShell reader used in CI.
#
# Run: bats deploy/test/ci-version-check.bats

setup() {
  DEPLOY_DIR="$BATS_TEST_DIRNAME/.."
  R="$(mktemp -d)"
  cd "$R" || return 1
  git init -q
  git config user.email 't@example.com'
  git config user.name 'Test'
  mkdir -p deploy
  cp "$DEPLOY_DIR/ci-version-check.sh" deploy/ci-version-check.sh
  cp "$DEPLOY_DIR/ci-base-version.sh" deploy/ci-base-version.sh
  export DEPLOY_DIR R
}
teardown() { [ -n "${R:-}" ] && rm -rf "$R"; }

write_unix() { mkdir -p deploy/unix/bin; printf 'INSTALLER_VERSION="%s"\n' "$1" > deploy/unix/bin/afctctl; }
write_win()  { mkdir -p deploy/windows/bin; printf '%s\n' "\$InstallerVersion = '$1'" > deploy/windows/bin/afctctl.ps1; }

@test "agreement passes when Unix and Windows versions match" {
  write_unix 2.2.3; write_win 2.2.3
  git add -A && git commit -qm base
  run sh deploy/ci-version-check.sh
  [ "$status" -eq 0 ]
  [[ "$output" == *"agrees across platforms: 2.2.3"* ]]
}

@test "agreement fails when Unix and Windows versions differ" {
  write_unix 2.2.3; write_win 2.2.4
  git add -A && git commit -qm mismatch
  run sh deploy/ci-version-check.sh
  [ "$status" -ne 0 ]
  [[ "$output" == *"versions differ"* ]]
}

@test "fails when the Windows controller version cannot be parsed" {
  write_unix 2.2.3
  mkdir -p deploy/windows/bin
  printf '# no version assignment here\n' > deploy/windows/bin/afctctl.ps1
  git add -A && git commit -qm unparseable
  run sh deploy/ci-version-check.sh
  [ "$status" -ne 0 ]
  [[ "$output" == *"could not parse the Windows"* ]]
}

@test "a Windows-only bundle change with no version bump fails" {
  write_unix 2.2.3; write_win 2.2.3
  git add -A && git commit -qm base
  _base=$(git rev-parse HEAD)
  # Change Windows bundle content but keep the version.
  printf '# a behavioral tweak\n' >> deploy/windows/bin/afctctl.ps1
  git add -A && git commit -qm 'windows change, no bump'
  run sh deploy/ci-version-check.sh "$_base"
  [ "$status" -ne 0 ]
  [[ "$output" == *"still 2.2.3"* ]]
}

@test "a Windows change with a matching version bump passes" {
  write_unix 2.2.3; write_win 2.2.3
  git add -A && git commit -qm base
  _base=$(git rev-parse HEAD)
  printf '# a behavioral tweak\n' >> deploy/windows/bin/afctctl.ps1
  write_unix 2.2.4; write_win 2.2.4
  git add -A && git commit -qm 'windows change + bump both'
  run sh deploy/ci-version-check.sh "$_base"
  [ "$status" -eq 0 ]
  [[ "$output" == *"bumped 2.2.3 -> 2.2.4"* ]]
}

@test "the base-version fallback (old Linux path) still gates the bump" {
  # Pre-refactor base: only the old Linux controller path exists.
  mkdir -p deploy/linux/bin
  printf 'INSTALLER_VERSION="2.2.3"\n' > deploy/linux/bin/afctctl
  git add -A && git commit -qm 'pre-refactor base'
  _base=$(git rev-parse HEAD)
  # Head: shared-Unix + Windows controllers, bundle changed, version bumped.
  git rm -q deploy/linux/bin/afctctl
  write_unix 2.2.4; write_win 2.2.4
  git add -A && git commit -qm 'reorg + bump'
  run sh deploy/ci-version-check.sh "$_base"
  [ "$status" -eq 0 ]
  [[ "$output" == *"bumped 2.2.3 -> 2.2.4"* ]]
}
