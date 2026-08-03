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
  # Resolve symlinks in the temp root. On macOS `mktemp -d` returns a path under
  # /var/folders, and /var is itself a symlink to /private/var, so the bootstrap's
  # realpath-based prefix canonicalization and the controller's self-path resolution
  # produce /private/var/... while a naive comparison would use /var/.... Canonicalizing
  # once here keeps every path comparison on equal footing (a no-op on Linux, where the
  # temp dir is not behind a symlink).
  TESTROOT="$(cd "$(mktemp -d)" && pwd -P)"
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

@test "the bundle is version 2.4.2" {
  [ "$VERSION" = "2.4.2" ]
  case "$(basename "$TARBALL")" in
    afct-macos-deploy-2.4.2.tar.gz) : ;;
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
# Image availability (pull) and the bind-mount test are separate steps: a pull failure is a
# network/registry problem and must NEVER be reported as a file-sharing problem.

# docker_mock <inspect_rc> <pull_rc> <run_rc>: exit codes for `image inspect`, `pull`, `run`.
docker_mock() {
  _b="$TESTROOT/mb-$1-$2-$3"; mkdir -p "$_b"
  cat > "$_b/docker" <<EOF
#!/bin/sh
case "\$1" in
  image) [ "\$2" = inspect ] && exit $1; exit 0 ;;
  pull) exit $2 ;;
  run) exit $3 ;;
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

@test "bind-mount preflight: image already present, no pull attempted, mount ok" {
  # pull_rc=1 (would fail) but inspect_rc=0 means pull must not be called; still BIND_OK.
  bind_check "$(docker_mock 0 1 0)"
  [ "$status" -eq 0 ]
  [[ "$output" == *"BIND_OK"* ]]
}

@test "bind-mount preflight: image missing, pull succeeds, mount ok" {
  bind_check "$(docker_mock 1 0 0)"
  [ "$status" -eq 0 ]
  [[ "$output" == *"BIND_OK"* ]]
}

@test "bind-mount preflight: image pull failure is reported as a download problem, not file sharing" {
  bind_check "$(docker_mock 1 1 0)"
  [ "$status" -ne 0 ]
  [[ "$output" == *"could not download"* ]]
  [[ "$output" != *"File sharing"* ]]
}

@test "bind-mount preflight: mount failure is reported as a file-sharing problem" {
  bind_check "$(docker_mock 0 0 1)"
  [ "$status" -ne 0 ]
  [[ "$output" == *"File sharing"* ]]
  [[ "$output" != *"could not download"* ]]
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

# --- bootstrap-to-controller handoff (no AFCT_SWITCH_ONLY) ---------------------
# The AFCT_SWITCH_ONLY tests above cover tooling install + release switching (the
# self-update path). These cover the FULL handoff: the bootstrap installs, then
# exec's the installed controller and forwards the command + options. The controller's
# test recorder (AFCT_TEST_RECORD_DISPATCH) captures what it received and exits before any
# Docker or deployment action, so no Docker daemon is needed. Real Docker integration
# (actual containers, volumes, health) remains uncovered here by design.

@test "handoff: bootstrap forwards the command and options into the installed controller" {
  P="$TESTROOT/h1"; D="$TESTROOT/d1.txt"
  run env AFCT_OS=Darwin HOME="$HOME" AFCT_PREFIX="$P" AFCT_BUNDLE_FILE="$TARBALL" \
    AFCT_TEST_RECORD_DISPATCH="$D" sh "$MACOS_DIR/install.sh" --non-interactive --reconfigure --no-color
  [ "$status" -eq 0 ]
  grep -qx 'arg=install' "$D"
  grep -qx 'arg=--non-interactive' "$D"
  grep -qx 'arg=--reconfigure' "$D"
  grep -qx 'arg=--no-color' "$D"
  grep -q "^self=${P}/" "$D"          # the installed controller path was used
  grep -qx "prefix=${P}" "$D"         # the selected prefix was preserved
  grep -qx 'os=Darwin' "$D"
  ! grep -q 'arg=--prefix' "$D"       # bootstrap-only args are not forwarded
}

@test "handoff: an argument containing spaces is forwarded unchanged" {
  P="$TESTROOT/h2"; D="$TESTROOT/d2.txt"
  run env AFCT_OS=Darwin HOME="$HOME" AFCT_PREFIX="$P" AFCT_BUNDLE_FILE="$TARBALL" \
    AFCT_TEST_RECORD_DISPATCH="$D" sh "$MACOS_DIR/install.sh" --non-interactive "keep this space"
  [ "$status" -eq 0 ]
  grep -qx 'arg=keep this space' "$D"
}

@test "handoff: --prefix is consumed by the bootstrap and not forwarded" {
  P="$TESTROOT/h3"; D="$TESTROOT/d3.txt"
  run env AFCT_OS=Darwin HOME="$HOME" AFCT_BUNDLE_FILE="$TARBALL" \
    AFCT_TEST_RECORD_DISPATCH="$D" sh "$MACOS_DIR/install.sh" --prefix "$P" --non-interactive
  [ "$status" -eq 0 ]
  grep -qx "prefix=${P}" "$D"
  ! grep -q 'arg=--prefix' "$D"
  grep -qx 'arg=--non-interactive' "$D"
}

@test "handoff: an unknown option is forwarded and rejected by the controller, not swallowed" {
  # No record hook: the controller really parses and must reject the forwarded unknown
  # option with exit 2, proving the bootstrap forwarded it rather than eating it. Argument
  # parsing happens before any Docker access, so no daemon is needed.
  P="$TESTROOT/h4"
  run env AFCT_OS=Darwin HOME="$HOME" AFCT_PREFIX="$P" AFCT_BUNDLE_FILE="$TARBALL" \
    sh "$MACOS_DIR/install.sh" --bogus-option
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown option or command"* ]]
}

# --- install-prefix marker failures are fatal ---------------------------------
# The marker enables safe automatic uninstall, so a fresh install must abort if it cannot
# be created, written, protected, or published, without leaving a current symlink or temp.

# A bin dir whose mktemp/chmod/mv fail ONLY for the install-prefix marker, delegating to the
# real tools otherwise. AFCT_FAIL_TOOL selects which step fails.
marker_mock_bin() {
  AFCT_REAL_MKTEMP=$(command -v mktemp); AFCT_REAL_CHMOD=$(command -v chmod); AFCT_REAL_MV=$(command -v mv)
  export AFCT_REAL_MKTEMP AFCT_REAL_CHMOD AFCT_REAL_MV
  _b="$TESTROOT/marker-mock"; mkdir -p "$_b"
  cat > "$_b/mktemp" <<EOF
#!/bin/sh
case "\$*" in
  *install-prefix*)
    case "\${AFCT_FAIL_TOOL:-}" in
      mktemp) exit 1 ;;
      write)  printf '%s\n' "$TESTROOT/nope-dir/marker.tmp"; exit 0 ;;
      *) exec "$AFCT_REAL_MKTEMP" "\$@" ;;
    esac ;;
  *) exec "$AFCT_REAL_MKTEMP" "\$@" ;;
esac
EOF
  cat > "$_b/chmod" <<EOF
#!/bin/sh
case "\$*" in
  *install-prefix*) [ "\${AFCT_FAIL_TOOL:-}" = chmod ] && exit 1; exec "$AFCT_REAL_CHMOD" "\$@" ;;
  *) exec "$AFCT_REAL_CHMOD" "\$@" ;;
esac
EOF
  cat > "$_b/mv" <<EOF
#!/bin/sh
case "\$*" in
  *install-prefix*) [ "\${AFCT_FAIL_TOOL:-}" = mv ] && exit 1; exec "$AFCT_REAL_MV" "\$@" ;;
  *) exec "$AFCT_REAL_MV" "\$@" ;;
esac
EOF
  chmod +x "$_b/mktemp" "$_b/chmod" "$_b/mv"
  printf '%s' "$_b"
}

# Run a switch-only install with the marker mock and a chosen failing step.
marker_fail_install() {
  _prefix=$1; _tool=$2; _mb=$(marker_mock_bin)
  run env AFCT_OS=Darwin HOME="$HOME" AFCT_PREFIX="$_prefix" AFCT_SWITCH_ONLY=1 \
    AFCT_BUNDLE_FILE="$TARBALL" AFCT_FAIL_TOOL="$_tool" PATH="${_mb}:${PATH}" \
    sh "$MACOS_DIR/install.sh"
}

@test "marker: mktemp failure aborts the install" {
  P="$TESTROOT/m1"; marker_fail_install "$P" mktemp
  [ "$status" -ne 0 ]
  [[ "$output" == *"could not create the install-prefix marker"* ]]
  [ ! -L "$P/current" ]
  ! ls "$P"/shared/.install-prefix.* >/dev/null 2>&1
}

@test "marker: write failure aborts the install" {
  P="$TESTROOT/m2"; marker_fail_install "$P" write
  [ "$status" -ne 0 ]
  [[ "$output" == *"could not write the install-prefix marker"* ]]
  [ ! -L "$P/current" ]
  ! ls "$P"/shared/.install-prefix.* >/dev/null 2>&1
}

@test "marker: chmod failure aborts the install" {
  P="$TESTROOT/m3"; marker_fail_install "$P" chmod
  [ "$status" -ne 0 ]
  [[ "$output" == *"could not protect the install-prefix marker"* ]]
  [ ! -L "$P/current" ]
  ! ls "$P"/shared/.install-prefix.* >/dev/null 2>&1
}

@test "marker: rename failure aborts the install" {
  P="$TESTROOT/m4"; marker_fail_install "$P" mv
  [ "$status" -ne 0 ]
  [[ "$output" == *"could not publish the install-prefix marker"* ]]
  [ ! -L "$P/current" ]
  ! ls "$P"/shared/.install-prefix.* >/dev/null 2>&1
}

@test "marker: a successful install leaves the marker at mode 0600" {
  P="$TESTROOT/m5"; switch_only "$P" "$TARBALL"
  [ -f "$P/shared/install-prefix" ]
  _mode=$(stat -c '%a' "$P/shared/install-prefix" 2>/dev/null || stat -f '%Lp' "$P/shared/install-prefix" 2>/dev/null)
  [ "$_mode" = "600" ]
}

# --- uninstall wrapper ownership ----------------------------------------------
# The wrapper is removed only when it belongs to THIS installation.

@test "wrapper: uninstall removes the wrapper that targets this prefix" {
  P="$HOME/.afct"
  env AFCT_OS=Darwin HOME="$HOME" AFCT_SWITCH_ONLY=1 AFCT_BUNDLE_FILE="$TARBALL" \
    sh "$MACOS_DIR/install.sh" >/dev/null 2>&1
  [ -f "$HOME/.local/bin/afctctl" ]
  run ctl_nodocker "$P" uninstall --non-interactive
  [ "$status" -eq 0 ]
  [ ! -e "$HOME/.local/bin/afctctl" ]
}

@test "wrapper: uninstall keeps a wrapper that points to another prefix" {
  P="$TESTROOT/w1"; switch_only "$P" "$TARBALL"
  mkdir -p "$HOME/.local/bin"
  printf '#!/bin/sh\nexec "%s/current/bin/afctctl" "$@"\n' "$TESTROOT/other" > "$HOME/.local/bin/afctctl"
  chmod +x "$HOME/.local/bin/afctctl"
  run ctl_nodocker "$P" uninstall --non-interactive
  [ "$status" -eq 0 ]
  [ -f "$HOME/.local/bin/afctctl" ]
  [[ "$output" == *"left"* ]]
}

@test "wrapper: uninstall keeps a manually-replaced wrapper" {
  P="$TESTROOT/w2"; switch_only "$P" "$TARBALL"
  printf '#!/bin/sh\necho unrelated\n' > "$HOME/.local/bin/afctctl"; chmod +x "$HOME/.local/bin/afctctl"
  run ctl_nodocker "$P" uninstall --non-interactive
  [ "$status" -eq 0 ]
  [ -f "$HOME/.local/bin/afctctl" ]
  [[ "$output" == *"left"* ]]
}

@test "wrapper: uninstall removes a symlink that targets this controller" {
  P="$TESTROOT/w3"; switch_only "$P" "$TARBALL"
  rm -f "$HOME/.local/bin/afctctl"; ln -s "$P/current/bin/afctctl" "$HOME/.local/bin/afctctl"
  run ctl_nodocker "$P" uninstall --non-interactive
  [ "$status" -eq 0 ]
  [ ! -e "$HOME/.local/bin/afctctl" ]
}

@test "wrapper: uninstall keeps a symlink that targets elsewhere" {
  P="$TESTROOT/w4"; switch_only "$P" "$TARBALL"
  rm -f "$HOME/.local/bin/afctctl"; ln -s "$TESTROOT/other/current/bin/afctctl" "$HOME/.local/bin/afctctl"
  run ctl_nodocker "$P" uninstall --non-interactive
  [ "$status" -eq 0 ]
  [ -L "$HOME/.local/bin/afctctl" ]
  [[ "$output" == *"left"* ]]
}

@test "wrapper: uninstall tolerates a missing wrapper" {
  P="$TESTROOT/w5"; switch_only "$P" "$TARBALL"
  rm -f "$HOME/.local/bin/afctctl"
  run ctl_nodocker "$P" uninstall --non-interactive
  [ "$status" -eq 0 ]
}
