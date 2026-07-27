#!/usr/bin/env bats
#
# Regression tests for the deployment-tooling hardening fixes: the atomic service marker,
# the transactional runtime Compose write, manifest/bundle version agreement, the strict
# manifest schema, local-bundle checksum enforcement, and strengthened release-directory
# validation.
#
# Run: bats deploy/test/deploy-hardening.bats

setup() {
  DEPLOY_DIR="$BATS_TEST_DIRNAME/.."
  LINUX_DIR="$DEPLOY_DIR/linux"
  UNIX_DIR="$DEPLOY_DIR/unix"
  TESTROOT="$(mktemp -d)"
  DIST="$TESTROOT/dist"
  export DEPLOY_DIR LINUX_DIR UNIX_DIR TESTROOT DIST
}

teardown() { [ -n "${TESTROOT:-}" ] && rm -rf "$TESTROOT"; }

build_bundle() { TARBALL="$(sh "$LINUX_DIR/build-bundle.sh" "$DIST")"; export TARBALL; }

# Repackage the built bundle with chosen internal versions and (optionally) a new filename.
# Echoes the path to the produced archive (+ writes its .sha256).
repackage() {
  # $1 out-path  $2 DEPLOY_VERSION  $3 INSTALLER_VERSION
  _out=$1; _dv=$2; _iv=$3
  _w="$TESTROOT/rp.$$.$RANDOM"; rm -rf "$_w"; mkdir -p "$_w"
  tar -xzf "$TARBALL" -C "$_w"; _top=$(ls "$_w")
  printf '%s\n' "$_dv" > "$_w/$_top/DEPLOY_VERSION"
  sed "s/^INSTALLER_VERSION=.*/INSTALLER_VERSION=\"$_iv\"/" "$_w/$_top/bin/afctctl" > "$_w/$_top/bin/afctctl.n"
  mv "$_w/$_top/bin/afctctl.n" "$_w/$_top/bin/afctctl"; chmod +x "$_w/$_top/bin/afctctl"
  ( cd "$_w" && tar -czf "$_out" "$_top" )
  printf '%s  %s\n' "$(sha256sum "$_out" | awk '{print $1}')" "$(basename "$_out")" > "${_out}.sha256"
  rm -rf "$_w"
}

install_local() {
  # $1 prefix  $2 bundle-file  (extra env passed by caller)
  AFCT_PREFIX="$1" AFCT_SWITCH_ONLY=1 AFCT_BUNDLE_FILE="$2" sh "$LINUX_DIR/install.sh"
}

# ---------------------------------------------------------------------------
# Fix 6: manifest schema validation (jq required)
# ---------------------------------------------------------------------------
manifest_check() {
  # $1 = JSON body; echoes VALID or INVALID
  printf '%s' "$1" > "$TESTROOT/m.json"
  sh -c '
    warn() { :; }; own_deploy_path() { :; }; SHARED_DIR="'"$TESTROOT"'"; REPO="x/y"
    . "'"$LINUX_DIR"'/lib/platform.sh"
    . "'"$UNIX_DIR"'/lib/manifest.sh"
    manifest_valid "'"$TESTROOT"'/m.json" && echo VALID || echo INVALID
  '
}

@test "manifest_valid accepts the exact schema and filename" {
  run manifest_check '{"schema":"afct-deployment-manifest/v1","deploymentToolVersion":"2.3.0","bundle":"afct-linux-deploy-2.3.0.tar.gz","sha256":"0000000000000000000000000000000000000000000000000000000000000000"}'
  [ "$output" = "VALID" ]
}

@test "manifest_valid rejects a missing or unknown schema" {
  run manifest_check '{"deploymentToolVersion":"2.3.0","bundle":"afct-linux-deploy-2.3.0.tar.gz","sha256":"0000000000000000000000000000000000000000000000000000000000000000"}'
  [ "$output" = "INVALID" ]
  run manifest_check '{"schema":"something-else","deploymentToolVersion":"2.3.0","bundle":"afct-linux-deploy-2.3.0.tar.gz","sha256":"0000000000000000000000000000000000000000000000000000000000000000"}'
  [ "$output" = "INVALID" ]
}

@test "manifest_valid rejects a wrong bundle filename and path separators" {
  run manifest_check '{"schema":"afct-deployment-manifest/v1","deploymentToolVersion":"2.3.0","bundle":"something-2.3.0.tar.gz","sha256":"0000000000000000000000000000000000000000000000000000000000000000"}'
  [ "$output" = "INVALID" ]
  run manifest_check '{"schema":"afct-deployment-manifest/v1","deploymentToolVersion":"2.3.0","bundle":"../afct-linux-deploy-2.3.0.tar.gz","sha256":"0000000000000000000000000000000000000000000000000000000000000000"}'
  [ "$output" = "INVALID" ]
}

@test "manifest_valid rejects malformed JSON and a bad sha256" {
  run manifest_check '{not json'
  [ "$output" = "INVALID" ]
  run manifest_check '{"schema":"afct-deployment-manifest/v1","deploymentToolVersion":"2.3.0","bundle":"afct-linux-deploy-2.3.0.tar.gz","sha256":"zz"}'
  [ "$output" = "INVALID" ]
}

# ---------------------------------------------------------------------------
# Fix 5: manifest / archive / bundled version agreement (fresh install)
# ---------------------------------------------------------------------------

@test "a bundle whose DEPLOY_VERSION and INSTALLER_VERSION agree installs" {
  build_bundle
  b="$TESTROOT/ok.tar.gz"; repackage "$b" 2.3.0 2.3.0
  # Filename does not carry the version here, so only internal agreement is checked.
  run install_local "$TESTROOT/opt" "$b"
  [ "$status" -eq 0 ]
  [ -x "$TESTROOT/opt/current/bin/afctctl" ]
}

@test "a bundle whose DEPLOY_VERSION and INSTALLER_VERSION disagree is rejected" {
  build_bundle
  b="$TESTROOT/bad.tar.gz"; repackage "$b" 2.3.0 2.2.0
  run install_local "$TESTROOT/opt" "$b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"version metadata disagrees"* ]]
  [ ! -e "$TESTROOT/opt/current" ]
}

@test "a requested --deploy-version that differs from the bundle is rejected" {
  build_bundle
  b="$TESTROOT/v.tar.gz"; repackage "$b" 2.3.0 2.3.0
  run env AFCT_PREFIX="$TESTROOT/opt" AFCT_SWITCH_ONLY=1 AFCT_BUNDLE_FILE="$b" AFCT_DEPLOY_VERSION=9.9.9 sh "$LINUX_DIR/install.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"requested deployment version 9.9.9"* ]]
}

@test "a standard bundle filename that disagrees with DEPLOY_VERSION is rejected" {
  build_bundle
  b="$TESTROOT/afct-linux-deploy-9.9.9.tar.gz"; repackage "$b" 2.3.0 2.3.0
  run install_local "$TESTROOT/opt" "$b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"does not match its DEPLOY_VERSION"* ]]
}

@test "a bundle missing INSTALLER_VERSION is rejected" {
  build_bundle
  _w="$TESTROOT/mi"; mkdir -p "$_w"; tar -xzf "$TARBALL" -C "$_w"; _top=$(ls "$_w")
  grep -v '^INSTALLER_VERSION=' "$_w/$_top/bin/afctctl" > "$_w/$_top/bin/afctctl.n"
  mv "$_w/$_top/bin/afctctl.n" "$_w/$_top/bin/afctctl"; chmod +x "$_w/$_top/bin/afctctl"
  b="$TESTROOT/mi.tar.gz"; ( cd "$_w" && tar -czf "$b" "$_top" )
  printf '%s  %s\n' "$(sha256sum "$b" | awk '{print $1}')" "$(basename "$b")" > "${b}.sha256"
  run install_local "$TESTROOT/opt" "$b"
  [ "$status" -ne 0 ]
  [[ "$output" == *"missing INSTALLER_VERSION"* ]]
}

# ---------------------------------------------------------------------------
# Fix 7: local bundles require a checksum by default
# ---------------------------------------------------------------------------

@test "a local bundle with a valid sibling checksum installs" {
  build_bundle
  cp "$TARBALL" "$TESTROOT/b.tar.gz"; cp "${TARBALL}.sha256" "$TESTROOT/b.tar.gz.sha256"
  ( cd "$TESTROOT" && sha256sum b.tar.gz > b.tar.gz.sha256 )
  run install_local "$TESTROOT/opt" "$TESTROOT/b.tar.gz"
  [ "$status" -eq 0 ]
}

@test "a local bundle with no checksum is rejected by default" {
  build_bundle
  cp "$TARBALL" "$TESTROOT/b.tar.gz"
  run install_local "$TESTROOT/opt" "$TESTROOT/b.tar.gz"
  [ "$status" -ne 0 ]
  [[ "$output" == *"no"*"sha256"* || "$output" == *"checksum"* ]]
  [ ! -e "$TESTROOT/opt/current" ]
}

@test "the explicit unverified override installs with a warning, not called verified" {
  build_bundle
  cp "$TARBALL" "$TESTROOT/b.tar.gz"
  run env AFCT_PREFIX="$TESTROOT/opt" AFCT_SWITCH_ONLY=1 AFCT_BUNDLE_FILE="$TESTROOT/b.tar.gz" \
    AFCT_ALLOW_UNVERIFIED_LOCAL_BUNDLE=1 sh "$LINUX_DIR/install.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"WITHOUT checksum verification"* ]]
  [[ "$output" != *"checksum verified"* ]]
  # Recorded in the installer log as unverified.
  run grep -F "UNVERIFIED local bundle" "$TESTROOT/opt/shared/install.log"
  [ "$status" -eq 0 ]
}

@test "the unverified override still rejects an internal version mismatch" {
  build_bundle
  b="$TESTROOT/b.tar.gz"; repackage "$b" 2.3.0 2.2.0; rm -f "${b}.sha256"
  run env AFCT_PREFIX="$TESTROOT/opt" AFCT_SWITCH_ONLY=1 AFCT_BUNDLE_FILE="$b" \
    AFCT_ALLOW_UNVERIFIED_LOCAL_BUNDLE=1 sh "$LINUX_DIR/install.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"version metadata disagrees"* ]]
}

# ---------------------------------------------------------------------------
# Fix 8: strengthened release-directory validation
# ---------------------------------------------------------------------------

@test "an existing target with only a fake bin/afctctl is quarantined and reinstalled" {
  build_bundle
  P="$TESTROOT/opt"
  # Compute the release id this bundle will use, then pre-create a bogus target dir. The
  # version comes from the controller (release-independent) so a version bump can't skew it.
  _sha=$(sha256sum "$TARBALL" | awk '{print $1}'); _pref=$(printf '%s' "$_sha" | cut -c1-12)
  _ver=$(sed -n 's/^INSTALLER_VERSION="\(.*\)"/\1/p' "$UNIX_DIR/bin/afctctl" | head -n1)
  _rid="${_ver}-${_pref}"
  mkdir -p "$P/releases/$_rid/bin"
  printf '#!/bin/sh\necho fake\n' > "$P/releases/$_rid/bin/afctctl"
  chmod +x "$P/releases/$_rid/bin/afctctl"
  run install_local "$P" "$TARBALL"
  [ "$status" -eq 0 ]
  [[ "$output" == *"incomplete or corrupt"* ]]
  # Quarantined copy exists, and the reinstalled release is complete and usable.
  ls "$P"/releases/${_rid}.corrupt.* >/dev/null 2>&1
  run env AFCT_PREFIX="$P" sh "$P/current/bin/afctctl" version
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Fix 3: atomic service-marker helper
# ---------------------------------------------------------------------------
marker_env() {
  # Runs the given snippet with service-user.sh + deps sourced and SHARED_DIR set.
  sh -c '
    info() { :; }; warn() { :; }; success() { :; }; die() { echo "DIE:$*"; exit 1; }
    own_deploy_path() { :; }
    SHARED_DIR="'"$1"'"; SERVICE_MARKER_NAME=".afct-service-user"
    PREFIX="'"$TESTROOT"'/opt"; ENV_FILE="'"$TESTROOT"'/opt/shared/.env.production"
    LOG_FILE="'"$TESTROOT"'/opt/shared/install.log"; SERVICE_USER="afct"
    state_file() { printf "%s/deploy.state" "$SHARED_DIR"; }
    manifest_cache_file() { printf "%s/deployment-manifest.json" "$SHARED_DIR"; }
    . "'"$LINUX_DIR"'/lib/service-user.sh"
    '"$2"'
  '
}

@test "write_service_marker writes exactly one username line at mode 0600" {
  S="$TESTROOT/shared"; mkdir -p "$S"
  run marker_env "$S" 'write_service_marker "custom-afct"; echo "content=$(cat "$SHARED_DIR/.afct-service-user")"; echo "mode=$(stat -c %a "$SHARED_DIR/.afct-service-user")"'
  [[ "$output" == *"content=custom-afct"* ]]
  [[ "$output" == *"mode=600"* ]]
  [ "$(sed -n '$=' "$S/.afct-service-user")" = "1" ]   # exactly one line
}

@test "write_service_marker rejects an empty or invalid username" {
  S="$TESTROOT/shared"; mkdir -p "$S"
  run marker_env "$S" 'write_service_marker ""'
  [[ "$output" == *"DIE:"* ]]
  run marker_env "$S" 'write_service_marker "bad name!"'
  [[ "$output" == *"DIE:"* ]]
  [ ! -f "$S/.afct-service-user" ]
}

@test "write_service_marker is idempotent" {
  S="$TESTROOT/shared"; mkdir -p "$S"
  run marker_env "$S" 'write_service_marker "afct"; write_service_marker "afct"; cat "$SHARED_DIR/.afct-service-user"'
  [ "$output" = "afct" ]
}

@test "write_service_marker fails loudly when the shared directory cannot be created" {
  # A regular file where the shared directory should be makes mkdir -p fail (even as root),
  # so the marker write must die rather than proceed.
  : > "$TESTROOT/blocker"
  run marker_env "$TESTROOT/blocker/sub" 'write_service_marker "afct"'
  [[ "$output" == *"DIE:"* ]]
  [ ! -e "$TESTROOT/blocker/sub" ]
}

# ---------------------------------------------------------------------------
# Fix 4: transactional runtime Compose write
# ---------------------------------------------------------------------------
compose_env() {
  # $1 = snippet. Sets up a real shared dir with a release compose and drives compose.sh.
  S="$TESTROOT/opt/shared"; mkdir -p "$S/runtime" "$TESTROOT/opt/releases/r"
  printf 'services: {a: 1}\n' > "$TESTROOT/opt/releases/r/docker-compose.yml"
  sh -c '
    info() { echo "INFO:$*"; }; warn() { :; }; die() { echo "DIE:$*"; exit 1; }
    own_deploy_path() { :; }
    SHARED_DIR="'"$S"'"
    RELEASE_COMPOSE_FILE="'"$TESTROOT"'/opt/releases/r/docker-compose.yml"
    COMPOSE_FILE="'"$S"'/runtime/docker-compose.yml"
    . "'"$UNIX_DIR"'/lib/common.sh"
    . "'"$UNIX_DIR"'/lib/migration.sh"
    . "'"$UNIX_DIR"'/lib/compose.sh"
    '"$1"'
  '
}

@test "ensure_runtime_compose seeds the runtime file and records its checksum" {
  run compose_env 'ensure_runtime_compose
    echo "exists=$( [ -f "$COMPOSE_FILE" ] && echo y )"
    echo "sha=$(state_get RUNTIME_COMPOSE_SHA)"
    echo "filesha=$(sha_of "$COMPOSE_FILE")"'
  [[ "$output" == *"exists=y"* ]]
  [[ "$output" == *"sha="* ]]
  # Recorded checksum equals the published file checksum.
  _sha=$(printf '%s\n' "$output" | sed -n 's/^sha=//p')
  _fsha=$(printf '%s\n' "$output" | sed -n 's/^filesha=//p')
  [ -n "$_sha" ] && [ "$_sha" = "$_fsha" ]
}

@test "a runtime file changed outside afctctl is left in place and reported" {
  run compose_env 'ensure_runtime_compose
    # Simulate a manual/updater edit that diverges from both the release and the record.
    printf "services: {a: 2, manual: true}\n" > "$COMPOSE_FILE"
    # Change the release too so a refresh would be attempted if provenance matched.
    printf "services: {a: 3}\n" > "$RELEASE_COMPOSE_FILE"
    ensure_runtime_compose
    echo "after=$(cat "$COMPOSE_FILE")"'
  [[ "$output" == *"changed outside afctctl"* ]]
  [[ "$output" == *"manual: true"* ]]
}

@test "an afctctl-managed runtime file is refreshed when the release changes" {
  run compose_env 'ensure_runtime_compose
    printf "services: {a: 9}\n" > "$RELEASE_COMPOSE_FILE"
    ensure_runtime_compose
    echo "after=$(cat "$COMPOSE_FILE")"
    echo "rec=$(state_get RUNTIME_COMPOSE_SHA)"
    echo "cur=$(sha_of "$COMPOSE_FILE")"'
  [[ "$output" == *"a: 9"* ]]
  _rec=$(printf '%s\n' "$output" | sed -n 's/^rec=//p')
  _cur=$(printf '%s\n' "$output" | sed -n 's/^cur=//p')
  [ "$_rec" = "$_cur" ]     # file and recorded checksum agree after refresh
}

@test "a failed state write rolls back and leaves the previous runtime file" {
  run compose_env 'ensure_runtime_compose
    _orig=$(cat "$COMPOSE_FILE")
    # Make state persistence fail on the next write.
    state_set() { return 1; }
    printf "services: {a: 42}\n" > "$RELEASE_COMPOSE_FILE"
    # die() exits its shell, so run the failing refresh in a subshell and inspect after.
    ( ensure_runtime_compose ) >/dev/null 2>&1 || true
    [ "$(cat "$COMPOSE_FILE")" = "$_orig" ] && echo UNCHANGED || echo CHANGED'
  [[ "$output" == *"UNCHANGED"* ]]
}
