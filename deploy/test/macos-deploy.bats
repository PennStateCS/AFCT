#!/usr/bin/env bats
#
# Tests for the AFCT macOS deployment tooling (deploy/macos/ + the shared deploy/unix/):
# the macOS bundle build, its manifest, and the macOS-specific afctctl behavior (no
# service accounts, no sudo, Docker Desktop handling, uninstall). Docker is mocked or
# absent; AFCT_OS=Darwin drives the macOS code paths on a Linux CI runner.
#
# Run: bats deploy/test/macos-deploy.bats

setup() {
  DEPLOY_DIR="$BATS_TEST_DIRNAME/.."
  UNIX_DIR="$DEPLOY_DIR/unix"
  MACOS_DIR="$DEPLOY_DIR/macos"
  TESTROOT="$(mktemp -d)"
  DIST="$TESTROOT/dist"
  VERSION="$(sed -n 's/^INSTALLER_VERSION="\(.*\)"/\1/p' "$UNIX_DIR/bin/afctctl" | head -n 1)"

  # Build the macOS bundle and unpack it into a release the controller can run from.
  TARBALL="$(sh "$MACOS_DIR/build-bundle.sh" "$DIST")"
  P="$TESTROOT/prefix"
  mkdir -p "$P/releases/dev" "$P/shared"
  tar -xzf "$TARBALL" -C "$P/releases/dev" --strip-components=1
  ln -s releases/dev "$P/current"
  CTL="$P/current/bin/afctctl"
  chmod +x "$CTL"

  # A bin dir for a controllable `docker` mock (some tests add or omit it).
  MOCKBIN="$TESTROOT/mockbin"
  mkdir -p "$MOCKBIN"

  export DEPLOY_DIR UNIX_DIR MACOS_DIR TESTROOT DIST VERSION TARBALL P CTL MOCKBIN
}

teardown() {
  [ -n "${TESTROOT:-}" ] && rm -rf "$TESTROOT"
}

# Write a `docker` mock into MOCKBIN. $1 = "info-ok" | "info-fail" ; compose v2 always ok.
write_docker_mock() {
  cat > "$MOCKBIN/docker" <<EOF
#!/bin/sh
case "\$1" in
  info) [ "$1" = "info-ok" ] && exit 0 || exit 1 ;;
  compose) [ "\$2" = "version" ] && exit 0 || exit 0 ;;
  *) exit 0 ;;
esac
EOF
  chmod +x "$MOCKBIN/docker"
}

# --- syntax --------------------------------------------------------------------

@test "every macOS shell file passes sh -n" {
  for f in "$MACOS_DIR/install.sh" "$MACOS_DIR/build-bundle.sh" \
           "$MACOS_DIR"/lib/*.sh "$UNIX_DIR/bin/afctctl"; do
    run sh -n "$f"
    [ "$status" -eq 0 ] || { echo "syntax error in $f"; echo "$output"; return 1; }
  done
}

# --- bundle + manifest ---------------------------------------------------------

@test "build-bundle produces a macOS tarball with a matching checksum" {
  [ -f "$TARBALL" ]
  case "$(basename "$TARBALL")" in
    afct-macos-deploy-"$VERSION".tar.gz) : ;;
    *) echo "unexpected bundle name: $TARBALL"; return 1 ;;
  esac
  # macOS runners have `shasum`, not `sha256sum`; accept whichever exists.
  if command -v sha256sum >/dev/null 2>&1; then
    ( cd "$DIST" && sha256sum -c "$(basename "$TARBALL").sha256" )
  else
    ( cd "$DIST" && shasum -a 256 -c "$(basename "$TARBALL").sha256" )
  fi
}

@test "the macOS manifest names the macOS bundle and bootstrap" {
  MF="$DIST/deployment-manifest-macos.json"
  [ -f "$MF" ]
  [ "$(jq -r .schema "$MF")" = "afct-deployment-manifest/v1" ]
  [ "$(jq -r .deploymentToolVersion "$MF")" = "$VERSION" ]
  [ "$(jq -r .bundle "$MF")" = "afct-macos-deploy-${VERSION}.tar.gz" ]
  [ "$(jq -r .bootstrap "$MF")" = "install-macos.sh" ]
  # The recorded sha256 matches the actual tarball.
  [ "$(jq -r .sha256 "$MF")" = "$(awk '{print $1; exit}' "${TARBALL}.sha256")" ]
}

@test "the macOS bundle ships the platform library and service-user stub" {
  [ -f "$P/releases/dev/lib/platform.sh" ]
  [ -f "$P/releases/dev/lib/service-user.sh" ]
  [ -f "$P/releases/dev/docker-compose.yml" ]
  grep -q "macOS" "$P/releases/dev/lib/platform.sh"
}

# --- afctctl macOS dispatch ----------------------------------------------------

@test "afctctl help shows the macOS interface without service-account options" {
  run env AFCT_OS=Darwin AFCT_PREFIX="$P" sh "$CTL" help
  [ "$status" -eq 0 ]
  [[ "$output" == *"macOS"* ]]
  [[ "$output" == *"uninstall"* ]]
  [[ "$output" != *"--service-user"* ]]
}

@test "afctctl version works on macOS" {
  run env AFCT_OS=Darwin AFCT_PREFIX="$P" sh "$CTL" version
  [ "$status" -eq 0 ]
  [[ "$output" == *"deployment tool version"* ]]
}

@test "afctctl rejects --service-user on macOS with a clear message" {
  run env AFCT_OS=Darwin AFCT_PREFIX="$P" sh "$CTL" --service-user afct install
  [ "$status" -eq 2 ]
  [[ "$output" == *"not supported on macOS"* ]]
}

@test "afctctl rejects --no-service-user on macOS" {
  run env AFCT_OS=Darwin AFCT_PREFIX="$P" sh "$CTL" --no-service-user install
  [ "$status" -eq 2 ]
  [[ "$output" == *"not supported on macOS"* ]]
}

@test "afctctl still rejects an unknown command on macOS" {
  run env AFCT_OS=Darwin AFCT_PREFIX="$P" sh "$CTL" frobnicate
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown option or command"* ]]
}

@test "uninstall preserves data and refuses a prefix with no install marker" {
  # No docker on PATH: container removal is skipped. This prefix was extracted by hand in
  # setup (no bootstrap), so it has no install-prefix marker; uninstall must refuse to
  # delete the tree and print manual-cleanup guidance. Exit 0.
  run env AFCT_OS=Darwin AFCT_PREFIX="$P" PATH="/usr/bin:/bin" sh "$CTL" uninstall --non-interactive
  [ "$status" -eq 0 ]
  [[ "$output" == *"uninstalled"* ]]
  [[ "$output" == *"not removing"* ]]
  [ -d "$P" ]
}

# --- Docker Desktop resolution -------------------------------------------------

@test "resolve_docker_access reports a missing Docker Desktop on macOS" {
  run sh -c '
    OS=Darwin; DOCKER_SUDO=""; COMPOSE_KIND=""; NON_INTERACTIVE=true
    die() { printf "%s\n" "$*"; exit 1; }
    error() { printf "%s\n" "$*"; }; info() { printf "%s\n" "$*"; }
    . "'"$UNIX_DIR"'/lib/docker.sh"
    . "'"$MACOS_DIR"'/lib/platform.sh"
    PATH="/nonexistent-only"; export PATH
    resolve_docker_access
  '
  [ "$status" -eq 1 ]
  [[ "$output" == *"Docker Desktop is not installed"* ]]
}

@test "resolve_docker_access reports Docker Desktop not running on macOS" {
  write_docker_mock info-fail
  run sh -c '
    OS=Darwin; DOCKER_SUDO=""; COMPOSE_KIND=""; NON_INTERACTIVE=true
    die() { printf "%s\n" "$*"; exit 1; }
    error() { printf "%s\n" "$*"; }; info() { printf "%s\n" "$*"; }
    . "'"$UNIX_DIR"'/lib/docker.sh"
    . "'"$MACOS_DIR"'/lib/platform.sh"
    PATH="'"$MOCKBIN"':/usr/bin:/bin"; export PATH
    resolve_docker_access
  '
  [ "$status" -eq 1 ]
  [[ "$output" == *"not running"* ]]
}

@test "resolve_docker_access succeeds when Docker Desktop is running with Compose v2" {
  write_docker_mock info-ok
  run sh -c '
    OS=Darwin; DOCKER_SUDO=""; COMPOSE_KIND=""; NON_INTERACTIVE=true
    die() { printf "%s\n" "$*"; exit 1; }
    error() { printf "%s\n" "$*"; }; info() { printf "%s\n" "$*"; }
    . "'"$UNIX_DIR"'/lib/docker.sh"
    . "'"$MACOS_DIR"'/lib/platform.sh"
    PATH="'"$MOCKBIN"':/usr/bin:/bin"; export PATH
    resolve_docker_access && printf "COMPOSE=%s\n" "$COMPOSE_KIND"
  '
  [ "$status" -eq 0 ]
  [[ "$output" == *"COMPOSE=v2"* ]]
}
