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

  # Build a real bundle and publish it as an asset under two version names so exact
  # matching can be exercised (2.2.0 = the real bundle, 2.2.10 = a decoy).
  TARBALL="$(sh "$LINUX_DIR/build-bundle.sh" "$DIST")"
  cp "$TARBALL" "$WEB/assets/afct-linux-deploy-2.2.0.tar.gz"
  cp "${TARBALL}.sha256" "$WEB/assets/afct-linux-deploy-2.2.0.tar.gz.sha256"
  # Recompute the checksum under the published name so it verifies.
  ( cd "$WEB/assets" && sha256sum afct-linux-deploy-2.2.0.tar.gz > afct-linux-deploy-2.2.0.tar.gz.sha256 )
  cp "$TARBALL" "$WEB/assets/afct-linux-deploy-2.2.10.tar.gz"
  ( cd "$WEB/assets" && sha256sum afct-linux-deploy-2.2.10.tar.gz > afct-linux-deploy-2.2.10.tar.gz.sha256 )

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
