#!/usr/bin/env bats
#
# End-to-end tests for the macOS bootstrap (deploy/macos/install.sh) and the macOS-only
# afctctl behaviors that depend on a real installed layout: prefix marker, custom-prefix
# uninstall safety, whitespace-safe pruning, and the Docker Desktop bind-mount preflight.
#
# Docker is mocked or absent: GitHub-hosted macOS runners have no usable Docker daemon, so
# this is NOT full Docker integration coverage. Installs use AFCT_SWITCH_ONLY (tooling
# install/switch without `afctctl install`), exactly as the deployment self-update does.
#
# AFCT_OS=Darwin drives the macOS code paths so the suite also runs on the Linux CI runner.
#
# Run: bats deploy/test/macos-bootstrap.bats

setup() {
  DEPLOY_DIR="$BATS_TEST_DIRNAME/.."
  MACOS_DIR="$DEPLOY_DIR/macos"
  UNIX_DIR="$DEPLOY_DIR/unix"
  TESTROOT="$(mktemp -d)"
  DIST="$TESTROOT/dist"
  HOME="$TESTROOT/home"; mkdir -p "$HOME"
  VERSION="$(sed -n 's/^INSTALLER_VERSION="\(.*\)"/\1/p' "$UNIX_DIR/bin/afctctl" | head -n 1)"
  TARBALL="$(sh "$MACOS_DIR/build-bundle.sh" "$DIST")"
  export DEPLOY_DIR MACOS_DIR UNIX_DIR TESTROOT DIST HOME VERSION TARBALL
}

teardown() {
  [ -n "${TESTROOT:-}" ] && rm -rf "$TESTROOT"
}

# Install the tooling into <prefix> from a local bundle in switch-only mode (no afctctl
# install, so no Docker needed).
switch_only() {
  env AFCT_OS=Darwin HOME="$HOME" AFCT_PREFIX="$1" AFCT_SWITCH_ONLY=1 AFCT_BUNDLE_FILE="$2" \
    sh "$MACOS_DIR/install.sh"
}

# --- refuses the wrong platform ------------------------------------------------

@test "bootstrap refuses to run on non-macOS" {
  run env AFCT_OS=Linux HOME="$HOME" AFCT_PREFIX="$TESTROOT/p" AFCT_SWITCH_ONLY=1 \
    AFCT_BUNDLE_FILE="$TARBALL" sh "$MACOS_DIR/install.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"macOS only"* ]]
}

# --- install from a local, checksummed bundle ----------------------------------

@test "install lays out a release, current symlink, executable afctctl, and version file" {
  P="$TESTROOT/p"
  run switch_only "$P" "$TARBALL"
  [ "$status" -eq 0 ]
  # exactly one release dir
  _rel=$(find "$P/releases" -maxdepth 1 -mindepth 1 -type d | head -n1)
  [ -n "$_rel" ]
  [ -L "$P/current" ]
  [ -x "$P/current/bin/afctctl" ]
  [ "$(cat "$P/current/DEPLOY_VERSION")" = "$VERSION" ]
}

@test "install records the canonical install-prefix marker (0600)" {
  P="$TESTROOT/p"
  switch_only "$P" "$TARBALL"
  [ -f "$P/shared/install-prefix" ]
  [ "$(cat "$P/shared/install-prefix")" = "$P" ]
  # GNU/busybox stat uses -c '%a'; BSD/macOS stat uses -f '%Lp'. Try GNU form first because
  # busybox `stat -f` means filesystem status (not file mode).
  _mode=$(stat -c '%a' "$P/shared/install-prefix" 2>/dev/null || stat -f '%Lp' "$P/shared/install-prefix" 2>/dev/null)
  [ "$_mode" = "600" ]
}

@test "afctctl version reports the deployment-tool version after install" {
  P="$TESTROOT/p"
  switch_only "$P" "$TARBALL"
  run env AFCT_OS=Darwin AFCT_PREFIX="$P" sh "$P/current/bin/afctctl" version
  [ "$status" -eq 0 ]
  [[ "$output" == *"$VERSION"* ]]
}

@test "the bundle is version 2.2.1" {
  [ "$VERSION" = "2.2.1" ]
  case "$(basename "$TARBALL")" in
    afct-macos-deploy-2.2.1.tar.gz) : ;;
    *) echo "unexpected bundle: $TARBALL"; return 1 ;;
  esac
}

@test "a second install of the same bundle is idempotent (current unchanged)" {
  P="$TESTROOT/p"
  switch_only "$P" "$TARBALL"
  _first=$(readlink "$P/current")
  run switch_only "$P" "$TARBALL"
  [ "$status" -eq 0 ]
  [ "$(readlink "$P/current")" = "$_first" ]
}

@test "the user command wrapper is created and runnable" {
  # Default prefix so the wrapper lands under the overridden HOME.
  run env AFCT_OS=Darwin HOME="$HOME" AFCT_SWITCH_ONLY=1 AFCT_BUNDLE_FILE="$TARBALL" \
    sh "$MACOS_DIR/install.sh"
  [ "$status" -eq 0 ]
  [ -x "$HOME/.local/bin/afctctl" ]
  run env AFCT_OS=Darwin sh "$HOME/.local/bin/afctctl" version
  [ "$status" -eq 0 ]
  [[ "$output" == *"$VERSION"* ]]
}

# --- verification / rejection paths --------------------------------------------

@test "a local bundle with a bad checksum is rejected" {
  printf 'deadbeef  %s\n' "$(basename "$TARBALL")" > "${TARBALL}.sha256"
  run switch_only "$TESTROOT/p" "$TARBALL"
  [ "$status" -ne 0 ]
  [[ "$output" == *"checksum mismatch"* ]]
}

@test "a local bundle without any checksum is rejected" {
  cp "$TARBALL" "$TESTROOT/nosum.tar.gz"   # no sibling .sha256
  run switch_only "$TESTROOT/p" "$TESTROOT/nosum.tar.gz"
  [ "$status" -ne 0 ]
  [[ "$output" == *"no "* ]]
  [[ "$output" == *".sha256"* ]]
}

@test "a same-version bundle with different content is refused" {
  P="$TESTROOT/p"
  switch_only "$P" "$TARBALL"
  # Repack a DIFFERENT-content bundle under the SAME version name.
  _w="$TESTROOT/w"; mkdir -p "$_w"
  tar -xzf "$TARBALL" -C "$_w"
  _top=$(find "$_w" -maxdepth 1 -mindepth 1 -type d | head -n1)
  printf '\n# altered content\n' >> "$_top/lib/output.sh"
  _alt="$TESTROOT/alt.tar.gz"
  ( cd "$_w" && tar -czf "$_alt" "$(basename "$_top")" )
  ( cd "$TESTROOT" && { sha256sum alt.tar.gz 2>/dev/null || shasum -a 256 alt.tar.gz; } > alt.tar.gz.sha256 )
  run switch_only "$P" "$_alt"
  [ "$status" -ne 0 ]
  [[ "$output" == *"already installed with different content"* ]]
}

@test "a new tooling controller that fails validation rolls back" {
  P="$TESTROOT/p"
  switch_only "$P" "$TARBALL"
  _good=$(readlink "$P/current")
  # Build a bundle at a HIGHER version whose afctctl exits non-zero (fails `version`), so
  # the switch-only install must roll back to the previous release.
  _w="$TESTROOT/w2"; mkdir -p "$_w"
  tar -xzf "$TARBALL" -C "$_w"
  _top=$(find "$_w" -maxdepth 1 -mindepth 1 -type d | head -n1)
  _new="afct-macos-deploy-9.9.9"
  mv "$_top" "$_w/$_new"
  printf '#!/bin/sh\nINSTALLER_VERSION="9.9.9"\nexit 1\n' > "$_w/$_new/bin/afctctl"
  chmod +x "$_w/$_new/bin/afctctl"
  printf '9.9.9\n' > "$_w/$_new/DEPLOY_VERSION"
  _broken="$TESTROOT/broken.tar.gz"
  ( cd "$_w" && tar -czf "$_broken" "$_new" )
  ( cd "$TESTROOT" && { sha256sum broken.tar.gz 2>/dev/null || shasum -a 256 broken.tar.gz; } > broken.tar.gz.sha256 )
  run switch_only "$P" "$_broken"
  [ "$status" -ne 0 ]
  # current rolled back to the previously good release
  [ "$(readlink "$P/current")" = "$_good" ]
}

# --- whitespace-safe prefix + pruning ------------------------------------------

@test "installs and prunes correctly under a prefix containing spaces" {
  P="$TESTROOT/App Support/AFCT"
  run env AFCT_OS=Darwin HOME="$HOME" AFCT_PREFIX="$P" AFCT_SWITCH_ONLY=1 \
    AFCT_KEEP_RELEASES=1 AFCT_BUNDLE_FILE="$TARBALL" sh "$MACOS_DIR/install.sh"
  [ "$status" -eq 0 ]
  [ -L "$P/current" ]
  [ -x "$P/current/bin/afctctl" ]
  # Seed two extra stale release dirs, then reinstall so pruning runs; keep=1 plus the
  # current and previous protections must not choke on the spaces in the path.
  mkdir -p "$P/releases/0.0.1-aaaaaaaaaaaa" "$P/releases/0.0.2-bbbbbbbbbbbb"
  run env AFCT_OS=Darwin HOME="$HOME" AFCT_PREFIX="$P" AFCT_SWITCH_ONLY=1 \
    AFCT_KEEP_RELEASES=1 AFCT_BUNDLE_FILE="$TARBALL" sh "$MACOS_DIR/install.sh"
  [ "$status" -eq 0 ]
  [ -L "$P/current" ]
  [ -d "$(readlink "$P/current")" ]
}

# --- uninstall safety (E2E) ----------------------------------------------------

# Run an installed afctctl with a command, Docker absent (PATH without docker), Darwin.
ctl_nodocker() {
  _p=$1; shift
  env AFCT_OS=Darwin HOME="$HOME" AFCT_PREFIX="$_p" PATH="/usr/bin:/bin" \
    sh "$_p/current/bin/afctctl" "$@"
}

@test "uninstall removes a valid default-style prefix (data preserved)" {
  P="$HOME/.afct"
  env AFCT_OS=Darwin HOME="$HOME" AFCT_SWITCH_ONLY=1 AFCT_BUNDLE_FILE="$TARBALL" \
    sh "$MACOS_DIR/install.sh" >/dev/null 2>&1
  run ctl_nodocker "$P" uninstall --non-interactive
  [ "$status" -eq 0 ]
  [[ "$output" == *"uninstalled"* ]]
  [ ! -d "$P" ]
}

@test "uninstall removes a valid custom prefix" {
  P="$TESTROOT/custom/AFCT"
  switch_only "$P" "$TARBALL"
  [ -f "$P/shared/install-prefix" ]
  run ctl_nodocker "$P" uninstall --non-interactive
  [ "$status" -eq 0 ]
  [ ! -d "$P" ]
}

@test "uninstall refuses when the prefix marker is missing" {
  P="$TESTROOT/custom2/AFCT"
  switch_only "$P" "$TARBALL"
  rm -f "$P/shared/install-prefix"
  run ctl_nodocker "$P" uninstall --non-interactive
  [ "$status" -eq 0 ]
  [[ "$output" == *"not removing"* ]]
  [ -d "$P" ]
}

@test "uninstall refuses when the prefix marker does not match" {
  P="$TESTROOT/custom3/AFCT"
  switch_only "$P" "$TARBALL"
  printf '/somewhere/else\n' > "$P/shared/install-prefix"
  run ctl_nodocker "$P" uninstall --non-interactive
  [ "$status" -eq 0 ]
  [[ "$output" == *"not removing"* ]]
  [ -d "$P" ]
}

# --- uninstall safety (unit: uninstall_prefix_is_safe) -------------------------

# Evaluate uninstall_prefix_is_safe for a path, echoing SAFE or UNSAFE.
prefix_safe() {
  run sh -c '
    HOME="'"$HOME"'"
    . "'"$MACOS_DIR"'/lib/platform.sh"
    uninstall_prefix_is_safe "'"$1"'" && echo SAFE || echo UNSAFE
  '
}

@test "uninstall_prefix_is_safe rejects root, home, and shallow paths" {
  prefix_safe "/";              [ "$output" = "UNSAFE" ]
  prefix_safe "$HOME";          [ "$output" = "UNSAFE" ]
  prefix_safe "$HOME/.local";   [ "$output" = "UNSAFE" ]
  prefix_safe "/usr";           [ "$output" = "UNSAFE" ]
}

@test "uninstall_prefix_is_safe rejects an incomplete structure and accepts a complete one" {
  P="$TESTROOT/u"
  # Incomplete: marker + dirs but no current symlink.
  mkdir -p "$P/releases" "$P/shared"
  printf '%s\n' "$P" > "$P/shared/install-prefix"
  prefix_safe "$P"; [ "$output" = "UNSAFE" ]
  # Complete: add the current symlink.
  mkdir -p "$P/releases/x"; ln -s releases/x "$P/current"
  prefix_safe "$P"; [ "$output" = "SAFE" ]
}

# --- Docker Desktop bind-mount preflight ---------------------------------------

# Write a docker mock into a bin dir: `run` succeeds ($1=ok) or fails ($1=fail).
docker_mock() {
  _b="$TESTROOT/mb-$1"; mkdir -p "$_b"
  if [ "$1" = "ok" ]; then _rc=0; else _rc=1; fi
  cat > "$_b/docker" <<EOF
#!/bin/sh
case "\$1" in
  run) exit ${_rc} ;;
  *) exit 0 ;;
esac
EOF
  chmod +x "$_b/docker"
  printf '%s' "$_b"
}

bind_check() {
  _bin=$1
  run sh -c '
    OS=Darwin; SERVICE_MODE=false; DOCKER_SUDO=""
    SHARED_DIR="'"$TESTROOT"'"; RUNTIME_DIR="'"$TESTROOT"'"
    die() { printf "%s\n" "$*"; exit 1; }
    error() { printf "%s\n" "$*"; }; info() { printf "%s\n" "$*"; }
    . "'"$UNIX_DIR"'/lib/docker.sh"
    . "'"$MACOS_DIR"'/lib/platform.sh"
    PATH="'"$_bin"':/usr/bin:/bin"; export PATH
    platform_check_bind_mounts && echo BIND_OK || echo BIND_FAIL
  '
}

@test "bind-mount preflight passes when Docker can mount the directory" {
  bind_check "$(docker_mock ok)"
  [ "$status" -eq 0 ]
  [[ "$output" == *"BIND_OK"* ]]
}

@test "bind-mount preflight fails with a file-sharing message when Docker cannot mount" {
  bind_check "$(docker_mock fail)"
  [ "$status" -ne 0 ]
  [[ "$output" == *"File sharing"* ]]
}

@test "bind-mount preflight is skipped when Docker is mocked off" {
  run sh -c '
    OS=Darwin; SHARED_DIR="'"$TESTROOT"'"; RUNTIME_DIR="'"$TESTROOT"'"
    AFCT_SKIP_BIND_MOUNT_CHECK=1
    die() { printf "%s\n" "$*"; exit 1; }
    error() { printf "%s\n" "$*"; }; info() { printf "%s\n" "$*"; }
    . "'"$UNIX_DIR"'/lib/docker.sh"
    . "'"$MACOS_DIR"'/lib/platform.sh"
    PATH="/usr/bin:/bin"; export PATH
    platform_check_bind_mounts && echo BIND_SKIPPED
  '
  [ "$status" -eq 0 ]
  [[ "$output" == *"BIND_SKIPPED"* ]]
}
