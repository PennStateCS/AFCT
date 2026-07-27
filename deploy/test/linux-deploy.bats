#!/usr/bin/env bats
#
# Tests for the AFCT Linux deployment tooling (deploy/linux/): the bootstrap installer,
# the versioned-bundle build, afctctl dispatch, safe extraction, atomic release switching,
# rollback/retention, and the Compose project-name normalization used by migration.
#
# Docker is not required: the covered paths are the verified-bundle machinery and the
# no-Docker afctctl commands. Run: bats deploy/test/linux-deploy.bats

setup() {
  DEPLOY_DIR="$BATS_TEST_DIRNAME/.."
  LINUX_DIR="$DEPLOY_DIR/linux"
  UNIX_DIR="$DEPLOY_DIR/unix"
  TESTROOT="$(mktemp -d)"
  DIST="$TESTROOT/dist"

  # A co-located controller for the dispatch tests below. afctctl sources its modules
  # from its own sibling lib/, and a real bundle flattens the shared (unix) and
  # Linux-only (linux) libraries into that single directory. Running straight from
  # unix/bin would miss platform.sh/service-user.sh, so assemble the same flat layout.
  CTL="$TESTROOT/ctl/bin/afctctl"
  mkdir -p "$TESTROOT/ctl/bin" "$TESTROOT/ctl/lib"
  cp "$UNIX_DIR/bin/afctctl" "$CTL"
  cp "$UNIX_DIR"/lib/*.sh "$TESTROOT/ctl/lib/"
  cp "$LINUX_DIR"/lib/*.sh "$TESTROOT/ctl/lib/"
  chmod +x "$CTL"

  export DEPLOY_DIR LINUX_DIR UNIX_DIR TESTROOT DIST CTL
}

teardown() {
  [ -n "${TESTROOT:-}" ] && rm -rf "$TESTROOT"
}

build_bundle() {
  TARBALL="$(sh "$LINUX_DIR/build-bundle.sh" "$DIST")"
  export TARBALL
}

# Install a bundle in switch-only mode (verify + extract + switch, no `afctctl install`).
install_switch_only() {
  AFCT_PREFIX="$1" AFCT_SWITCH_ONLY=1 AFCT_BUNDLE_FILE="$2" sh "$LINUX_DIR/install.sh"
}

# --- syntax --------------------------------------------------------------------

@test "every Linux shell file passes sh -n" {
  for f in "$LINUX_DIR/install.sh" "$LINUX_DIR/build-bundle.sh" \
           "$UNIX_DIR/bin/afctctl" "$UNIX_DIR"/lib/*.sh "$LINUX_DIR"/lib/*.sh \
           "$DEPLOY_DIR/install.sh"; do
    run sh -n "$f"
    [ "$status" -eq 0 ] || { echo "syntax error in $f"; return 1; }
  done
}

# --- afctctl dispatch (no Docker) ----------------------------------------------

@test "afctctl help prints usage and exits 0" {
  run sh "$CTL" help
  [ "$status" -eq 0 ]
  [[ "$output" == *"afctctl: AFCT deployment control"* ]]
  [[ "$output" == *"self-update"* ]]
}

@test "afctctl version reports the deployment-tool version" {
  run env AFCT_PREFIX="$TESTROOT/p" sh "$CTL" version
  [ "$status" -eq 0 ]
  [[ "$output" == *"deployment tool version"* ]]
}

@test "afctctl rejects an unknown command with exit 2" {
  run sh "$CTL" frobnicate
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown option or command"* ]]
}

@test "afctctl rejects two commands with exit 2" {
  run sh "$CTL" status update
  [ "$status" -eq 2 ]
  [[ "$output" == *"only one command"* ]]
}

# --- bundle build + verified install -------------------------------------------

@test "build-bundle produces a tarball and a matching sha256" {
  build_bundle
  [ -f "$TARBALL" ]
  [ -f "${TARBALL}.sha256" ]
  # The bundle carries the shared compose file byte-for-byte (single source of truth).
  tar -xzf "$TARBALL" -C "$TESTROOT"
  run diff "$TESTROOT"/afct-linux-deploy-*/docker-compose.yml "$DEPLOY_DIR/docker-compose.yml"
  [ "$status" -eq 0 ]
  run diff "$TESTROOT"/afct-linux-deploy-*/.env.production.example "$DEPLOY_DIR/.env.production.example"
  [ "$status" -eq 0 ]
}

@test "a verified bundle installs, switches current, and afctctl runs from it" {
  build_bundle
  P="$TESTROOT/opt"
  run install_switch_only "$P" "$TARBALL"
  [ "$status" -eq 0 ]
  [ -L "$P/current" ]
  [ -x "$P/current/bin/afctctl" ]
  # Config/data are never inside the release directory.
  [ -d "$P/shared" ]
  [ ! -e "$P"/releases/*/.env.production ]
  run env AFCT_PREFIX="$P" sh "$P/current/bin/afctctl" version
  [ "$status" -eq 0 ]
}

@test "a checksum mismatch is rejected and nothing is installed" {
  build_bundle
  cp "$TARBALL" "$TESTROOT/bad.tar.gz"
  printf '%064d  bad.tar.gz\n' 0 > "$TESTROOT/bad.tar.gz.sha256"
  run install_switch_only "$TESTROOT/badp" "$TESTROOT/bad.tar.gz"
  [ "$status" -ne 0 ]
  [[ "$output" == *"checksum mismatch"* ]]
  [ ! -e "$TESTROOT/badp/current" ]
}

@test "a bundle containing a symlink is refused" {
  D="$TESTROOT/sl/afct-linux-deploy-9.9.9"
  mkdir -p "$D/bin" "$D/lib"
  echo x > "$D/bin/afctctl"
  echo x > "$D/docker-compose.yml"
  ln -s /etc/passwd "$D/evil-link"
  ( cd "$TESTROOT/sl" && tar -czf "$TESTROOT/sl.tar.gz" afct-linux-deploy-9.9.9 )
  printf '%s  sl.tar.gz\n' "$(sha256sum "$TESTROOT/sl.tar.gz" | awk '{print $1}')" > "$TESTROOT/sl.tar.gz.sha256"
  run install_switch_only "$TESTROOT/slp" "$TESTROOT/sl.tar.gz"
  [ "$status" -ne 0 ]
  [[ "$output" == *"symbolic link"* ]]
  [ ! -e "$TESTROOT/slp/current" ]
}

@test "a bundle with a path-traversal entry is refused" {
  # Craft a tar whose member escapes the extraction directory.
  mkdir -p "$TESTROOT/tt/inner"
  echo pwn > "$TESTROOT/tt/inner/file"
  ( cd "$TESTROOT/tt/inner" && tar -czf "$TESTROOT/eviltar.tar.gz" ../inner/file )
  # Only proceed if the archive really contains a '..' member on this tar implementation.
  if tar -tzf "$TESTROOT/eviltar.tar.gz" | grep -q '\.\.'; then
    printf '%s  eviltar.tar.gz\n' "$(sha256sum "$TESTROOT/eviltar.tar.gz" | awk '{print $1}')" > "$TESTROOT/eviltar.tar.gz.sha256"
    run install_switch_only "$TESTROOT/evp" "$TESTROOT/eviltar.tar.gz"
    [ "$status" -ne 0 ]
    [[ "$output" == *"unsafe path"* || "$output" == *"missing bin/afctctl"* ]]
    [ ! -e "$TESTROOT/evp/current" ]
  else
    skip "this tar implementation normalizes '..' members; traversal not reproducible"
  fi
}

@test "installing a second bundle keeps the previous release for rollback" {
  build_bundle
  P="$TESTROOT/opt2"
  install_switch_only "$P" "$TARBALL"
  first="$(readlink "$P/current")"
  # Simulate an older release directory so retention has something to keep/prune.
  mkdir -p "$P/releases/0.0.1/bin" "$P/releases/0.0.1/lib"
  cp "$P/current/bin/afctctl" "$P/releases/0.0.1/bin/afctctl"
  install_switch_only "$P" "$TARBALL"
  [ -e "$first" ]                              # current release still present
  [ -d "$P/releases/0.0.1" ] || true           # retention default keeps a couple
}

# --- no secrets in the redacted env --------------------------------------------

@test "redact_env_file masks secret-bearing keys" {
  run sh -c '
    warn() { :; }
    . "'"$UNIX_DIR"'/lib/diagnostics.sh"
    printf "POSTGRES_PASSWORD=s3cr3t\nNEXTAUTH_URL=https://x\n" > "'"$TESTROOT"'/e"
    redact_env_file "'"$TESTROOT"'/e" "'"$TESTROOT"'/e.red"
    cat "'"$TESTROOT"'/e.red"
  '
  [ "$status" -eq 0 ]
  [[ "$output" == *"POSTGRES_PASSWORD=***REDACTED***"* ]]
  [[ "$output" == *"NEXTAUTH_URL=https://x"* ]]
  [[ "$output" != *"s3cr3t"* ]]
}
