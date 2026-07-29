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
  UNIX_DIR="$DEPLOY_DIR/unix"
  TESTROOT="$(mktemp -d)"
  DIST="$TESTROOT/dist"
  export DEPLOY_DIR LINUX_DIR UNIX_DIR TESTROOT DIST
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
  # A clearly-newer version (release-independent) so this never collides with the base
  # bundle's version and always exercises the switch-and-validate path.
  printf '9.9.9\n' > "$_work/$_top/DEPLOY_VERSION"
  cat > "$_work/$_top/bin/afctctl" <<'EOF'
#!/bin/sh
# Deliberately broken tooling: passes `sh -n` and the version-agreement check (its
# INSTALLER_VERSION matches DEPLOY_VERSION), but fails its post-switch validation.
INSTALLER_VERSION="9.9.9"
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
    . "'"$LINUX_DIR"'/lib/platform.sh"
    . "'"$UNIX_DIR"'/lib/manifest.sh"
    good="'"$TESTROOT"'/good.json"
    printf "%s" "{\"schema\":\"afct-deployment-manifest/v1\",\"deploymentToolVersion\":\"2.2.0\",\"bundle\":\"afct-linux-deploy-2.2.0.tar.gz\",\"sha256\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"bootstrap\":\"install.sh\"}" > "$good"
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
    . "'"$UNIX_DIR"'/lib/update.sh"
    reexec_argv | tr "\n" "|"
  '
  [ "$output" = "install|--yes|--non-interactive|--with-updater|--no-color|--service-user=custom-afct|" ]
}

@test "reexec_argv preserves --no-service-user and a bare update" {
  run sh -c '
    MODE=update; ASSUME_YES=false; NON_INTERACTIVE=true; FORCE_RECONFIGURE=false
    WITH_UPDATER=false; COLOR_FORCED_OFF=false; SERVICE_USER_CHOICE="--no-service-user"
    . "'"$UNIX_DIR"'/lib/update.sh"
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
    . "'"$UNIX_DIR"'/lib/migration.sh"
    detect_project_name_from_volumes
  '
  [ "$output" = "afct" ]   # NOT "decoy" (which matched only postgres_data)
}

@test "existing_data_without_config ignores volumes left by a different project name" {
  run sh -c '
    resolve_docker_access_soft() { return 0; }
    COMPOSE_KIND=v2; COMPOSE_PROJECT_NAME=afct; ENV_FILE="'"$TESTROOT"'/absent.env"
    . "'"$UNIX_DIR"'/lib/compose.sh"
    compose_volume_names() { printf "postgres_data\nuploads_data\n"; }
    docker_cmd() {
      case "$*" in
        *"volume ls"*) printf "otherproj_postgres_data\notherproj_uploads_data\nunrelated\n" ;;
        *) : ;;
      esac
    }
    if existing_data_without_config; then echo BLOCK; else echo PROCEED; fi
  '
  [ "$output" = "PROCEED" ]
}

@test "existing_data_without_config blocks when this project owns an existing data volume" {
  run sh -c '
    resolve_docker_access_soft() { return 0; }
    COMPOSE_KIND=v2; COMPOSE_PROJECT_NAME=afct; ENV_FILE="'"$TESTROOT"'/absent.env"
    . "'"$UNIX_DIR"'/lib/compose.sh"
    compose_volume_names() { printf "postgres_data\nuploads_data\n"; }
    docker_cmd() {
      case "$*" in
        *"volume ls"*) printf "afct_postgres_data\nunrelated\n" ;;
        *) : ;;
      esac
    }
    if existing_data_without_config; then echo BLOCK; else echo PROCEED; fi
  '
  [ "$output" = "BLOCK" ]
}

@test "validate_compose surfaces the actual compose error in its message" {
  run sh -c '
    die() { echo "DIE:$*"; exit 1; }
    . "'"$UNIX_DIR"'/lib/compose.sh"
    compose_project() { echo "env file /x/.env.production not found" >&2; return 1; }
    validate_compose
  '
  [ "$status" -eq 1 ]
  [[ "$output" == *"env file /x/.env.production not found"* ]]
}

@test "valid_compose_project_name accepts valid names and rejects invalid ones" {
  run sh -c '
    . "'"$UNIX_DIR"'/lib/migration.sh"
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
