#!/usr/bin/env bats
#
# Remote-resolution tests for the bootstrap installer: resolving a specific deployment-tool
# version from a GitHub-style releases listing (array response), served by a local mock
# HTTP server, with jq installed. Covers exact-filename matching, the not-found and
# malformed-JSON paths, and the archive/checksum-present-but-other-missing cases (item 4).
#
# Requires curl, jq, and busybox httpd (all present in the bats image after apk add curl).
#
# Run: bats deploy/test/deploy-remote.bats

PORT=8099
API="http://127.0.0.1:${PORT}/releases"

setup() {
  DEPLOY_DIR="$BATS_TEST_DIRNAME/.."
  LINUX_DIR="$DEPLOY_DIR/linux"
  TESTROOT="$(mktemp -d)"
  WEB="$TESTROOT/web"
  DIST="$TESTROOT/dist"
  mkdir -p "$WEB/assets"
  export DEPLOY_DIR LINUX_DIR TESTROOT WEB DIST

  # Build a real bundle and publish it as an asset under two DISTINCT versions so exact
  # matching can be exercised (2.2.0 = the real bundle; 2.2.10 = a genuine variant whose
  # internal DEPLOY_VERSION and INSTALLER_VERSION are 2.2.10, so the bootstrap's version
  # agreement check passes for it too).
  TARBALL="$(sh "$LINUX_DIR/build-bundle.sh" "$DIST")"
  publish_version_asset 2.2.0
  publish_version_asset 2.2.10

  # A tiny static file server. Query strings (?per_page&page) are ignored, so a request for
  # /releases?... serves the `releases` file, matching the GitHub API shape closely enough.
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$WEB" >/dev/null 2>&1 &
  HTTPD_PID=$!
  export HTTPD_PID
  # Wait until it answers.
  _i=0
  while [ "$_i" -lt 50 ]; do
    curl -fsS "http://127.0.0.1:${PORT}/assets/afct-linux-deploy-2.2.0.tar.gz.sha256" >/dev/null 2>&1 && break
    _i=$((_i + 1)); sleep 0.1
  done
}

teardown() {
  [ -n "${HTTPD_PID:-}" ] && kill "$HTTPD_PID" 2>/dev/null || true
  [ -n "${TESTROOT:-}" ] && rm -rf "$TESTROOT"
}

# Repackage the built bundle as afct-linux-deploy-<ver>.tar.gz with matching internal
# DEPLOY_VERSION and INSTALLER_VERSION (so the bootstrap's version-agreement check passes),
# publish it under /assets, and write its checksum next to it.
publish_version_asset() {
  _v=$1
  _w="$TESTROOT/pkg.$_v"; rm -rf "$_w"; mkdir -p "$_w"
  tar -xzf "$TARBALL" -C "$_w"
  _top=$(ls "$_w")
  printf '%s\n' "$_v" > "$_w/$_top/DEPLOY_VERSION"
  sed "s/^INSTALLER_VERSION=.*/INSTALLER_VERSION=\"$_v\"/" "$_w/$_top/bin/afctctl" > "$_w/$_top/bin/afctctl.new"
  mv "$_w/$_top/bin/afctctl.new" "$_w/$_top/bin/afctctl"
  chmod +x "$_w/$_top/bin/afctctl"
  ( cd "$_w" && tar -czf "$WEB/assets/afct-linux-deploy-${_v}.tar.gz" "$_top" )
  ( cd "$WEB/assets" && sha256sum "afct-linux-deploy-${_v}.tar.gz" > "afct-linux-deploy-${_v}.tar.gz.sha256" )
  rm -rf "$_w"
}

# Write the releases listing (a JSON array) that the mock API returns. Args are asset
# basenames to advertise (each gets a browser_download_url under /assets).
write_releases() {
  {
    printf '['
    printf '{"tag_name":"v0.1.0","assets":['
    _first=1
    for _name in "$@"; do
      [ "$_first" = 1 ] || printf ','
      _first=0
      printf '{"name":"%s","browser_download_url":"http://127.0.0.1:%s/assets/%s"}' "$_name" "$PORT" "$_name"
    done
    printf ']}'
    printf ']'
  } > "$WEB/releases"
}

install_deploy_version() {
  AFCT_PREFIX="$1" AFCT_SWITCH_ONLY=1 AFCT_RELEASE_API="$API" \
    sh "$LINUX_DIR/install.sh" --deploy-version "$2"
}

@test "--deploy-version resolves and installs the exact version (jq)" {
  write_releases afct-linux-deploy-2.2.0.tar.gz afct-linux-deploy-2.2.0.tar.gz.sha256
  P="$TESTROOT/opt"
  run install_deploy_version "$P" 2.2.0
  [ "$status" -eq 0 ]
  [ -x "$P/current/bin/afctctl" ]
  run env AFCT_PREFIX="$P" sh "$P/current/bin/afctctl" version
  [ "$status" -eq 0 ]
}

@test "--deploy-version for a missing version fails clearly" {
  write_releases afct-linux-deploy-2.2.0.tar.gz afct-linux-deploy-2.2.0.tar.gz.sha256
  run install_deploy_version "$TESTROOT/opt" 9.9.9
  [ "$status" -ne 0 ]
  [[ "$output" == *"was not found"* ]]
  [ ! -e "$TESTROOT/opt/current" ]
}

@test "--deploy-version matches the exact filename, not a similar prefix" {
  # Only 2.2.10 is published; requesting 2.2.0 must NOT match it.
  write_releases afct-linux-deploy-2.2.10.tar.gz afct-linux-deploy-2.2.10.tar.gz.sha256
  run install_deploy_version "$TESTROOT/opt" 2.2.0
  [ "$status" -ne 0 ]
  [[ "$output" == *"was not found"* ]]
  # And requesting 2.2.10 explicitly does resolve.
  run install_deploy_version "$TESTROOT/opt2" 2.2.10
  [ "$status" -eq 0 ]
}

@test "--deploy-version with a malformed release listing fails safely" {
  printf '%s' '{not valid json' > "$WEB/releases"
  run install_deploy_version "$TESTROOT/opt" 2.2.0
  [ "$status" -ne 0 ]
  [[ "$output" == *"was not found"* ]]
  [ ! -e "$TESTROOT/opt/current" ]
}

@test "--deploy-version with the archive present but the checksum missing is refused" {
  # Advertise only the tarball asset, not its .sha256.
  write_releases afct-linux-deploy-2.2.0.tar.gz
  run install_deploy_version "$TESTROOT/opt" 2.2.0
  [ "$status" -ne 0 ]
  [[ "$output" == *"no checksum"* ]]
  [ ! -e "$TESTROOT/opt/current" ]
}

@test "--deploy-version with the checksum present but the archive missing is refused" {
  # Advertise only the .sha256 asset, not the tarball.
  write_releases afct-linux-deploy-2.2.0.tar.gz.sha256
  run install_deploy_version "$TESTROOT/opt" 2.2.0
  [ "$status" -ne 0 ]
  [[ "$output" == *"was not found"* ]]
  [ ! -e "$TESTROOT/opt/current" ]
}
