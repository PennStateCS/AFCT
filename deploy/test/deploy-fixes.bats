#!/usr/bin/env bats
#
# Regression tests for the versioned Linux deployment fixes (deploy/linux/): absolute-prefix
# enforcement, content-addressed immutable releases, the deployment manifest, self-update
# argument preservation, Compose project-name resolution, legacy service-account
# preservation, and the compatibility shim's command forwarding.
#
# The archive/extraction/switch machinery and the operational commands are covered by
# linux-deploy.bats and afctctl.bats; a real `docker compose config` against the split
# release/shared layout is covered by deploy/test/compose-config.sh.
#
# Run: bats deploy/test/deploy-fixes.bats

setup() {
  DEPLOY_DIR="$BATS_TEST_DIRNAME/.."
  LINUX_DIR="$DEPLOY_DIR/linux"
  TESTROOT="$(mktemp -d)"
  DIST="$TESTROOT/dist"
  export DEPLOY_DIR LINUX_DIR TESTROOT DIST
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

# Repackage a bundle with the same version but altered content, so its digest differs.
# Echoes the path to the new archive (+ writes its .sha256).
repackage_variant() {
  _src=$1
  _out=$2
  _work="$TESTROOT/variant.$$"
  rm -rf "$_work"; mkdir -p "$_work"
  tar -xzf "$_src" -C "$_work"
  _top=$(ls "$_work")
  printf '\n# variant marker %s\n' "$$" >> "$_work/$_top/lib/common.sh"
  ( cd "$_work" && tar -czf "$_out" "$_top" )
  printf '%s  %s\n' "$(sha256sum "$_out" | awk '{print $1}')" "$(basename "$_out")" > "${_out}.sha256"
  rm -rf "$_work"
}

# ---------------------------------------------------------------------------
# Item 10: absolute-prefix enforcement
# ---------------------------------------------------------------------------

@test "a relative install prefix is rejected" {
  build_bundle
  run env AFCT_PREFIX="relative/afct" AFCT_SWITCH_ONLY=1 AFCT_BUNDLE_FILE="$TARBALL" sh "$LINUX_DIR/install.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"absolute path"* ]]
  [ ! -e "relative/afct/current" ]
}

@test "a prefix containing .. is rejected" {
  build_bundle
  run env AFCT_PREFIX="/opt/../etc/afct" AFCT_SWITCH_ONLY=1 AFCT_BUNDLE_FILE="$TARBALL" sh "$LINUX_DIR/install.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"path segments"* ]]
}

@test "a valid custom absolute prefix installs" {
  build_bundle
  P="$TESTROOT/srv/afct"
  run install_switch_only "$P" "$TARBALL"
  [ "$status" -eq 0 ]
  [ -x "$P/current/bin/afctctl" ]
}

@test "a foreign non-symlink current is refused, leaving it untouched" {
  build_bundle
  P="$TESTROOT/opt"
  mkdir -p "$P"
  printf 'not a symlink\n' > "$P/current"
  run install_switch_only "$P" "$TARBALL"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not a symlink"* ]]
  [ -f "$P/current" ]
}

# ---------------------------------------------------------------------------
# Item 3: content-addressed, immutable releases
# ---------------------------------------------------------------------------

@test "installing the same exact bundle twice is idempotent" {
  build_bundle
  P="$TESTROOT/opt"
  install_switch_only "$P" "$TARBALL"
  first="$(readlink "$P/current")"
  _n1=$(ls -1d "$P"/releases/*/ | wc -l)
  install_switch_only "$P" "$TARBALL"
  [ "$(readlink "$P/current")" = "$first" ]
  _n2=$(ls -1d "$P"/releases/*/ | wc -l)
  [ "$_n1" = "$_n2" ]                          # no second release directory created
  run env AFCT_PREFIX="$P" sh "$P/current/bin/afctctl" version
  [ "$status" -eq 0 ]
}

@test "the same version with different content is rejected and current is unchanged" {
  build_bundle
  P="$TESTROOT/opt"
  install_switch_only "$P" "$TARBALL"
  first="$(readlink "$P/current")"
  variant="$TESTROOT/variant.tar.gz"
  repackage_variant "$TARBALL" "$variant"
  run install_switch_only "$P" "$variant"
  [ "$status" -ne 0 ]
  [[ "$output" == *"already installed with different content"* ]]
  # The active release did not move, and afctctl still works.
  [ "$(readlink "$P/current")" = "$first" ]
  run env AFCT_PREFIX="$P" sh "$P/current/bin/afctctl" version
  [ "$status" -eq 0 ]
}

@test "a switch-only validation failure rolls back and leaves current usable" {
  build_bundle
  P="$TESTROOT/opt"
  install_switch_only "$P" "$TARBALL"
  good="$(readlink "$P/current")"
  # A NEWER release whose afctctl is broken so `afctctl version` fails after the switch: the
  # bootstrap must restore the previous pointer. A different version avoids the same-version
  # digest guard, so the switch-and-validate path is actually exercised.
  broken="$TESTROOT/broken.tar.gz"
  _work="$TESTROOT/bw"; rm -rf "$_work"; mkdir -p "$_work"
  tar -xzf "$TARBALL" -C "$_work"; _top=$(ls "$_work")
  printf '2.2.1\n' > "$_work/$_top/DEPLOY_VERSION"
  cat > "$_work/$_top/bin/afctctl" <<'EOF'
#!/bin/sh
# Deliberately broken tooling: passes `sh -n`, but fails its post-switch validation.
[ "$1" = "version" ] && exit 7
exit 0
EOF
  chmod +x "$_work/$_top/bin/afctctl"
  ( cd "$_work" && tar -czf "$broken" "$_top" )
  printf '%s  %s\n' "$(sha256sum "$broken" | awk '{print $1}')" "$(basename "$broken")" > "${broken}.sha256"
  run install_switch_only "$P" "$broken"
  [ "$status" -ne 0 ]
  [[ "$output" == *"roll"* ]]
  # Rolled back to the known-good release; afctctl still runs.
  [ "$(readlink "$P/current")" = "$good" ]
  run env AFCT_PREFIX="$P" sh "$P/current/bin/afctctl" version
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Item 5: deployment manifest (schema validation + build output)
# ---------------------------------------------------------------------------

@test "build-bundle emits a deployment manifest that matches the bundle" {
  build_bundle
  M="$DIST/deployment-manifest.json"
  [ -f "$M" ]
  run jq -r '.deploymentToolVersion' "$M"; [ -n "$output" ]
  _bundle=$(jq -r '.bundle' "$M")
  _sha=$(jq -r '.sha256' "$M")
  [ "$_bundle" = "$(basename "$TARBALL")" ]
  [ "$_sha" = "$(sha256sum "$TARBALL" | awk '{print $1}')" ]
}

@test "manifest_valid accepts a good manifest and rejects malformed ones" {
  run sh -c '
    info() { :; }; warn() { :; }; own_deploy_path() { :; }
    SHARED_DIR="'"$TESTROOT"'"; REPO="x/y"
    . "'"$LINUX_DIR"'/lib/manifest.sh"
    good="'"$TESTROOT"'/good.json"
    printf "%s" "{\"deploymentToolVersion\":\"2.2.0\",\"bundle\":\"afct-linux-deploy-2.2.0.tar.gz\",\"sha256\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"bootstrap\":\"install.sh\"}" > "$good"
    manifest_valid "$good" && echo GOOD_OK || echo GOOD_FAIL
    printf "%s" "{not json" > "'"$TESTROOT"'/bad1.json"; manifest_valid "'"$TESTROOT"'/bad1.json" && echo BAD1_ACCEPTED || echo BAD1_REJECTED
    printf "%s" "{\"bundle\":\"x.tar.gz\",\"sha256\":\"00\"}" > "'"$TESTROOT"'/bad2.json"; manifest_valid "'"$TESTROOT"'/bad2.json" && echo BAD2_ACCEPTED || echo BAD2_REJECTED
    printf "%s" "{\"deploymentToolVersion\":\"2.2.0\",\"bundle\":\"a/b.tar.gz\",\"sha256\":\"0000000000000000000000000000000000000000000000000000000000000000\"}" > "'"$TESTROOT"'/bad3.json"; manifest_valid "'"$TESTROOT"'/bad3.json" && echo BAD3_ACCEPTED || echo BAD3_REJECTED
  '
  [[ "$output" == *"GOOD_OK"* ]]
  [[ "$output" == *"BAD1_REJECTED"* ]]
  [[ "$output" == *"BAD2_REJECTED"* ]]
  [[ "$output" == *"BAD3_REJECTED"* ]]   # bundle with a path separator
}

# ---------------------------------------------------------------------------
# Item 6: self-update preserves all command-line options
# ---------------------------------------------------------------------------

@test "reexec_argv rebuilds the full original command, not just the command name" {
  run sh -c '
    MODE=install; ASSUME_YES=true; NON_INTERACTIVE=true; FORCE_RECONFIGURE=false
    WITH_UPDATER=true; COLOR_FORCED_OFF=true; SERVICE_USER_CHOICE="--service-user=custom-afct"
    . "'"$LINUX_DIR"'/lib/update.sh"
    reexec_argv | tr "\n" "|"
  '
  [ "$output" = "install|--yes|--non-interactive|--with-updater|--no-color|--service-user=custom-afct|" ]
}

@test "reexec_argv preserves --no-service-user and a bare update" {
  run sh -c '
    MODE=update; ASSUME_YES=false; NON_INTERACTIVE=true; FORCE_RECONFIGURE=false
    WITH_UPDATER=false; COLOR_FORCED_OFF=false; SERVICE_USER_CHOICE="--no-service-user"
    . "'"$LINUX_DIR"'/lib/update.sh"
    reexec_argv | tr "\n" "|"
  '
  [ "$output" = "update|--non-interactive|--no-service-user|" ]
}

# ---------------------------------------------------------------------------
# Item 9: Compose project-name resolution (complete volume-set match)
# ---------------------------------------------------------------------------

@test "project name from volumes requires the COMPLETE expected set, not a partial suffix" {
  cf="$TESTROOT/compose.yml"; printf 'services: {}\n' > "$cf"
  run sh -c '
    info() { :; }; warn() { :; }; die() { echo "DIE:$*"; exit 1; }
    resolve_docker_access_soft() { return 0; }
    COMPOSE_KIND=v2; COMPOSE_FILE="'"$cf"'"
    # config --volumes -> the expected short volume names
    compose_raw() { printf "postgres_data\nuploads_data\n"; }
    # volume ls -> a decoy that only matches ONE volume, then the real complete set
    docker_cmd() {
      case "$*" in
        *"volume ls"*) printf "decoy_postgres_data\nafct_postgres_data\nafct_uploads_data\nunrelated\n" ;;
        *) : ;;
      esac
    }
    . "'"$LINUX_DIR"'/lib/migration.sh"
    detect_project_name_from_volumes
  '
  [ "$output" = "afct" ]   # NOT "decoy" (which matched only postgres_data)
}

@test "valid_compose_project_name accepts valid names and rejects invalid ones" {
  run sh -c '
    . "'"$LINUX_DIR"'/lib/migration.sh"
    for n in afct afct-deploy afct_1 ""; do valid_compose_project_name "$n" && echo "OK:$n" || echo "NO:$n"; done
    valid_compose_project_name "-lead" && echo "OK:-lead" || echo "NO:-lead"
    valid_compose_project_name "Bad Name" && echo "OK:bad" || echo "NO:bad"
  '
  [[ "$output" == *"OK:afct"* ]]
  [[ "$output" == *"OK:afct-deploy"* ]]
  [[ "$output" == *"NO:"* ]]
  [[ "$output" == *"NO:-lead"* ]]
  [[ "$output" == *"NO:bad"* ]]
}

# ---------------------------------------------------------------------------
# Item 8: legacy service-account preservation (inspect marker before creating one)
# ---------------------------------------------------------------------------

# Drive preserve_or_setup_service_account with stubs and a controlled legacy directory.
run_preserve() {
  # $1 = SERVICE_USER_CHOICE, $2 = marker contents ("" for none), $3 = existing user id ok?
  _legacy="$TESTROOT/legacy.$$"; rm -rf "$_legacy"; mkdir -p "$_legacy"
  printf 'NEXTAUTH_URL=https://x\n' > "$_legacy/.env.production"
  [ -n "$2" ] && printf '%s\n' "$2" > "$_legacy/.afct-service-user"
  AFCT_LEGACY_DIR="$_legacy" _CHOICE="$1" _IDOK="$3" sh -c '
    info() { echo "INFO:$*"; }; warn() { echo "WARN:$*"; }
    id() { [ "$_IDOK" = "yes" ] && return 0 || return 1; }
    SERVICE_MODE="false"; ENV_FILE="'"$TESTROOT"'/nope-shared/.env.production"
    SERVICE_MARKER_NAME=".afct-service-user"; PREFIX="'"$TESTROOT"'/nope-prefix"
    SERVICE_USER="afct"; SERVICE_USER_CHOICE="$_CHOICE"
    . "'"$LINUX_DIR"'/lib/migration.sh"
    . "'"$LINUX_DIR"'/lib/service-user.sh"
    # Stub AFTER sourcing so it overrides the real function (the point under test is only
    # WHETHER account creation is invoked, not what it does).
    maybe_setup_service_user() { echo "SETUP_CALLED"; }
    preserve_or_setup_service_account
    echo "MODE=$SERVICE_MODE USER=$SERVICE_USER"
  '
}

@test "migration preserves a custom legacy service account" {
  run run_preserve "" "custom-afct" "yes"
  [[ "$output" == *"preserving the existing 'custom-afct'"* ]]
  [[ "$output" == *"MODE=true USER=custom-afct"* ]]
  [[ "$output" != *"SETUP_CALLED"* ]]
}

@test "migration keeps current-user mode when the legacy install had no marker" {
  run run_preserve "" "" "yes"
  [[ "$output" == *"no dedicated service account"* ]]
  [[ "$output" == *"USER="* ]]
  [[ "$output" != *"SETUP_CALLED"* ]]
}

@test "migration falls back to current-user when the marked account is missing" {
  run run_preserve "" "gone-afct" "no"
  [[ "$output" == *"no longer exists"* ]]
  [[ "$output" != *"SETUP_CALLED"* ]]
}

@test "an explicit --no-service-user overrides an inferred legacy account" {
  run run_preserve "--no-service-user" "custom-afct" "yes"
  [[ "$output" != *"SETUP_CALLED"* ]]
  [[ "$output" != *"preserving"* ]]
}

@test "an explicit --service-user converts even a legacy current-user install" {
  run run_preserve "--service-user=new-afct" "" "yes"
  [[ "$output" == *"SETUP_CALLED"* ]]
}

# ---------------------------------------------------------------------------
# Item 7: compatibility shim forwards the original command verbatim
# ---------------------------------------------------------------------------

@test "the shim forwards a legacy command to an installed afctctl unchanged" {
  P="$TESTROOT/opt"
  mkdir -p "$P/current/bin"
  cat > "$P/current/bin/afctctl" <<'EOF'
#!/bin/sh
printf 'AFCTCTL_ARGS:%s\n' "$*"
EOF
  chmod +x "$P/current/bin/afctctl"
  run env AFCT_PREFIX="$P" sh "$DEPLOY_DIR/install.sh" status
  [ "$status" -eq 0 ]
  [[ "$output" == *"AFCTCTL_ARGS:status"* ]]
  [[ "$output" != *"install status"* ]]
}

@test "the shim maps a bare invocation to install" {
  P="$TESTROOT/opt"
  mkdir -p "$P/current/bin"
  cat > "$P/current/bin/afctctl" <<'EOF'
#!/bin/sh
printf 'AFCTCTL_ARGS:%s\n' "$*"
EOF
  chmod +x "$P/current/bin/afctctl"
  run env AFCT_PREFIX="$P" sh "$DEPLOY_DIR/install.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"AFCTCTL_ARGS:install"* ]]
}
