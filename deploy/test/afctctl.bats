#!/usr/bin/env bats
#
# Release-gate tests for the afctctl operations command (deploy/linux/). Docker is mocked
# (deploy/test/mocks), so these exercise afctctl's own logic - argument parsing, the
# interactive / non-interactive split, config writing, the operational commands, the
# no-secrets-in-the-log guarantee, and the failure paths - without a daemon.
#
# The harness lays out an installed afctctl release under TESTDIR and drives it through
# the compatibility shim (deploy/install.sh), so `sh install.sh <command>` forwards to
# afctctl exactly as it does on a migrated host. Configuration, the log, and the compose
# file are redirected into TESTDIR with the documented AFCT_* overrides so the assertions
# can read .env.production in the working directory, the way the old monolith wrote it.
#
# The bundle machinery itself (verified download, safe extraction, atomic switch,
# rollback, retention, self-update) is covered separately in linux-deploy.bats.
#
# Run: bats deploy/test/afctctl.bats

setup() {
  DEPLOY_DIR="$BATS_TEST_DIRNAME/.."
  LINUX_DIR="$DEPLOY_DIR/linux"
  UNIX_DIR="$DEPLOY_DIR/unix"
  TESTDIR="$(mktemp -d)"

  # An installed release the shim can forward to: bin/afctctl + the library modules,
  # with current -> releases/dev. PREFIX is TESTDIR/opt; shared/ holds state. The bundle
  # lib/ is flat, so it carries the shared unix modules plus the Linux-only ones.
  REL="$TESTDIR/opt/releases/dev"
  mkdir -p "$REL/bin" "$REL/lib" "$TESTDIR/opt/shared"
  cp "$UNIX_DIR/bin/afctctl" "$REL/bin/afctctl"
  cp "$UNIX_DIR"/lib/*.sh "$REL/lib/"
  cp "$LINUX_DIR"/lib/*.sh "$REL/lib/"
  ln -s releases/dev "$TESTDIR/opt/current"
  # The shim resolves and exec's the release afctctl, so it must be executable regardless
  # of the checkout's file mode (a plain `cp` would otherwise inherit a non-exec bit).
  chmod +x "$REL/bin/afctctl"

  # The shim (deploy/install.sh) forwards to $AFCT_PREFIX/current/bin/afctctl.
  cp "$DEPLOY_DIR/install.sh" "$TESTDIR/install.sh"

  # A compose file must exist for `-f docker-compose.yml`; the mock ignores contents.
  cp "$DEPLOY_DIR/docker-compose.yml" "$TESTDIR/docker-compose.yml" 2>/dev/null \
    || printf 'services: {}\n' > "$TESTDIR/docker-compose.yml"
  # A fresh install reads the example env file when present.
  cp "$DEPLOY_DIR/.env.production.example" "$TESTDIR/.env.production.example" 2>/dev/null \
    || printf '# example\n' > "$TESTDIR/.env.production.example"

  # Mocks first on PATH so docker/sleep/curl/systemctl are the fakes.
  chmod +x "$BATS_TEST_DIRNAME/mocks/"* 2>/dev/null || true
  PATH="$BATS_TEST_DIRNAME/mocks:$PATH"
  export PATH

  export MOCK_HEALTH="healthy"
  export APP_URL="https://afct.test"
  # Keep the health-wait loop short so timeout cases finish quickly (sleep is mocked).
  export AFCT_HEALTH_TIMEOUT=10
  export AFCT_HEALTH_INTERVAL=1

  # Point config/log/compose at TESTDIR so the assertions read them in the working
  # directory. These are the documented test/override seams afctctl honors.
  export AFCT_PREFIX="$TESTDIR/opt"
  export AFCT_COMPOSE_FILE="$TESTDIR/docker-compose.yml"
  export AFCT_ENV_FILE="$TESTDIR/.env.production"
  export AFCT_ENV_EXAMPLE="$TESTDIR/.env.production.example"
  export AFCT_LOG_FILE="$TESTDIR/install.log"

  # These tests run as root inside the bats image, which would otherwise trigger the
  # dedicated-service-account path. Default the suite to installing as the current user;
  # the service-account path has its own tests that opt in explicitly.
  export AFCT_SERVICE_USER=""

  cd "$TESTDIR"
}

teardown() {
  [ -n "${TESTDIR:-}" ] && rm -rf "$TESTDIR"
}

# A complete managed configuration, as afctctl would have written it.
write_complete_env() {
  cat > .env.production <<'EOF'
NODE_ENV=production
POSTGRES_PASSWORD=abc123abc123abc123
DATABASE_URL=postgresql://afct_user:abc123abc123abc123@postgres:5432/afct
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=Str0ng!Pass1
NEXTAUTH_SECRET=secretsecretsecretsecretsecret12
NEXTAUTH_URL=https://afct.test
AUTH_TRUST_HOST=true
AFCT_APP_TAG=v0.0.1
EOF
  chmod 600 .env.production
}

# --- CLI surface ---------------------------------------------------------------

@test "update notes a newer deployment tool and continues (non-interactive)" {
  write_complete_env
  # The deployment manifest advertises a newer deployment-tool version than this one. The
  # mock curl serves MOCK_CURL_BODY for the manifest URL (not versions.json/compose).
  export MOCK_CURL_BODY='{"schema":"afct-deployment-manifest/v1","deploymentToolVersion":"9999.0.0","bundle":"afct-linux-deploy-9999.0.0.tar.gz","sha256":"0000000000000000000000000000000000000000000000000000000000000000","bootstrap":"install.sh"}'
  # (already carries the schema and the exact bundle filename the stricter manifest requires)
  run sh install.sh update --non-interactive
  [ "$status" -eq 0 ]
  [[ "$output" == *"newer deployment tool (9999.0.0)"* ]]
  # Non-interactive without -y must not self-update; it points at the command instead.
  [[ "$output" == *"self-update"* ]]
}

@test "--help prints usage and exits 0" {
  run sh install.sh --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
  [[ "$output" == *"--non-interactive"* ]]
}

@test "an unknown option is rejected (exit 2), not treated as an install" {
  run sh install.sh --diagnositcs
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown option"* ]]
}

@test "supplying two commands is rejected (exit 2)" {
  run sh install.sh status update
  [ "$status" -eq 2 ]
  [[ "$output" == *"only one command"* ]]
}

# --- non-interactive required-value handling -----------------------------------

@test "--non-interactive without ADMIN_EMAIL fails fast (no prompt loop)" {
  unset ADMIN_EMAIL ADMIN_PASSWORD
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"ADMIN_EMAIL is required"* ]]
}

@test "--non-interactive without ADMIN_PASSWORD fails fast" {
  export ADMIN_EMAIL="admin@example.com"
  unset ADMIN_PASSWORD
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"ADMIN_PASSWORD or ADMIN_PASSWORD_FILE is required"* ]]
}

# --- config writing ------------------------------------------------------------

@test "--non-interactive writes a complete, unquoted .env.production" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -eq 0 ]
  run grep -Eq '^POSTGRES_PASSWORD=.+' .env.production; [ "$status" -eq 0 ]
  run grep -Eq '^DATABASE_URL=postgresql://' .env.production; [ "$status" -eq 0 ]
  run grep -Eq '^ADMIN_EMAIL=admin@example.com$' .env.production; [ "$status" -eq 0 ]
  run grep -Eq '^NEXTAUTH_SECRET=.+' .env.production; [ "$status" -eq 0 ]
  # Values are stored UNQUOTED so Compose v1 and v2 read them identically.
  run grep -q "ADMIN_PASSWORD='" .env.production; [ "$status" -ne 0 ]
  run grep -Eq '^ADMIN_PASSWORD=Str0ng!Pass1$' .env.production; [ "$status" -eq 0 ]
}

@test "a fresh install pins AFCT_APP_TAG to the newest release from the manifest" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  # Mock curl serves this manifest for the versions.json download; newest release first,
  # the rolling 'main' entry must be skipped.
  export MOCK_VERSIONS_BODY='{ "versions": [ { "tag": "v2.3.4" }, { "tag": "v2.0.0" }, { "tag": "main" } ] }'
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -eq 0 ]
  run grep -Eq '^AFCT_APP_TAG=v2.3.4$' .env.production; [ "$status" -eq 0 ]
}

@test "an explicit AFCT_APP_TAG that is a published release is honored" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  export AFCT_APP_TAG="v2.0.0"
  export MOCK_VERSIONS_BODY='{ "versions": [ { "tag": "v2.3.4" }, { "tag": "v2.0.0" }, { "tag": "main" } ] }'
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -eq 0 ]
  run grep -Eq '^AFCT_APP_TAG=v2.0.0$' .env.production; [ "$status" -eq 0 ]
}

@test "AFCT_APP_TAG=main is refused (releases only)" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  export AFCT_APP_TAG="main"
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"not allowed"* ]]
  run grep -q '^AFCT_APP_TAG=main' .env.production; [ "$status" -ne 0 ]
}

@test "an explicit AFCT_APP_TAG that is not a published release is refused" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  export AFCT_APP_TAG="v9.9.9"
  export MOCK_VERSIONS_BODY='{ "versions": [ { "tag": "v2.3.4" }, { "tag": "main" } ] }'
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"not a published release"* ]]
}

@test "a fresh install refuses to fall back to main when no release is available" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  export MOCK_VERSIONS_BODY='{ "versions": [ { "tag": "main" } ] }'
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"could not determine the latest release"* ]]
}

@test "an http:// public URL is upgraded to https (the stack serves HTTPS)" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  export APP_URL="http://afct.example.edu"
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -eq 0 ]
  run grep -Eq '^NEXTAUTH_URL=https://afct.example.edu$' .env.production; [ "$status" -eq 0 ]
  run grep -q '^NEXTAUTH_URL=http://' .env.production; [ "$status" -ne 0 ]
}

@test "an http://localhost public URL is left as-is for local testing" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  export APP_URL="http://localhost:8080"
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -eq 0 ]
  run grep -Eq '^NEXTAUTH_URL=http://localhost:8080$' .env.production; [ "$status" -eq 0 ]
}

@test "a password containing an unsupported character is rejected before writing" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Bad'Pass1A"
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"cannot"* ]]
  [ ! -f .env.production ]
}

# --- security: the generated admin password must not leak into the log ---------

@test "a generated admin password never lands in install.log" {
  export ADMIN_EMAIL="admin@example.com"
  unset ADMIN_PASSWORD                       # no TTY + --yes => auto-generate
  run sh install.sh --yes < /dev/null
  [ "$status" -eq 0 ]
  pw="$(sed -n 's/^ADMIN_PASSWORD=//p' .env.production)"
  [ -n "$pw" ]
  run grep -F "$pw" install.log
  [ "$status" -ne 0 ]                          # password absent from the log
}

# --- log handling --------------------------------------------------------------

@test "diagnostics does not truncate the existing install.log" {
  printf 'SENTINEL-FROM-PRIOR-RUN\n' > install.log
  run sh install.sh diagnostics < /dev/null
  run grep -Fq 'SENTINEL-FROM-PRIOR-RUN' install.log
  [ "$status" -eq 0 ]
}

# --- deploy failure paths are fatal --------------------------------------------

@test "a failed image pull is fatal" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  export MOCK_PULL_RC=42
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"could not be downloaded"* ]]
}

@test "an invalid compose configuration is fatal (before pulling)" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  export MOCK_CONFIG_RC=1
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"Compose configuration is invalid"* ]]
}

@test "a health-check timeout is fatal, not reported as success" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  export MOCK_HEALTH="starting"               # never reaches healthy -> timeout
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"did not become healthy"* ]]
  [[ "$output" != *"AFCT Dashboard is ready"* ]]
}

@test "an unhealthy app container is fatal" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  export MOCK_HEALTH="unhealthy"
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"unhealthy"* ]]
}

@test "a missing app container is fatal" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  export MOCK_PS_EMPTY=1
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"did not become healthy"* ]]
}

# --- operational commands ------------------------------------------------------

@test "status reports the application's health" {
  write_complete_env
  run sh install.sh status
  [ "$status" -eq 0 ]
  [[ "$output" == *"application health: healthy"* ]]
}

@test "status reports when the app container is not running" {
  write_complete_env
  export MOCK_PS_EMPTY=1
  run sh install.sh status
  [ "$status" -ne 0 ]
  [[ "$output" == *"not running"* ]]
}

@test "logs exits cleanly" {
  write_complete_env
  run sh install.sh logs
  [ "$status" -eq 0 ]
}

@test "update without a configuration is refused (and collects no bundle)" {
  run sh install.sh update < /dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"Run the installer first"* ]]
  [[ "$output" != *"collecting AFCT diagnostics"* ]]
}

@test "update pulls, restarts, and reports completion" {
  write_complete_env
  run sh install.sh update < /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"update completed"* ]]
}

# --- pinned updates persist the deployed tag -----------------------------------
#
# Compose lets an exported AFCT_APP_TAG override the env file, so a pinned update
# (AFCT_APP_TAG=vX.Y.Z afctctl update) deploys that tag. The env file must then record
# it, or the next plain update silently redeploys the OLD pin while reporting success.

@test "a pinned update records the deployed tag in the env file" {
  write_complete_env
  export AFCT_APP_TAG="v0.2.0"
  run sh install.sh update < /dev/null
  [ "$status" -eq 0 ]
  run grep -Eq '^AFCT_APP_TAG=v0.2.0$' .env.production; [ "$status" -eq 0 ]
  run grep -c '^AFCT_APP_TAG=' .env.production; [ "$output" = "1" ]
}

@test "a plain update leaves the existing pin unchanged" {
  write_complete_env
  run sh install.sh update < /dev/null
  [ "$status" -eq 0 ]
  run grep -Eq '^AFCT_APP_TAG=v0.0.1$' .env.production; [ "$status" -eq 0 ]
}

@test "a pinned update that fails its health check does not touch the pin" {
  write_complete_env
  export AFCT_APP_TAG="v0.2.0"
  export MOCK_HEALTH="unhealthy"
  run sh install.sh update < /dev/null
  [ "$status" -ne 0 ]
  run grep -Eq '^AFCT_APP_TAG=v0.0.1$' .env.production; [ "$status" -eq 0 ]
}

@test "a pinned update to main never records a main pin" {
  write_complete_env
  export AFCT_APP_TAG="main"
  run sh install.sh update < /dev/null
  [ "$status" -eq 0 ]
  run grep -Eq '^AFCT_APP_TAG=v0.0.1$' .env.production; [ "$status" -eq 0 ]
  [[ "$output" == *"rolling main build"* ]]
}

@test "update is refused up-front when the disk is too small for the images" {
  write_complete_env
  # An unreachable requirement stands in for a full disk. The real failure this
  # guards is a pull dying part-way with "no space left on device".
  export AFCT_UPDATE_MIN_FREE_MB=999999999
  run sh install.sh update < /dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"is needed to download the new images"* ]]
  # Refused before pulling: nothing was downloaded or recreated.
  [[ "$output" != *"downloading AFCT container images"* ]]
}

@test "a successful update prunes superseded images but keeps the rollback target" {
  write_complete_env
  export MOCK_RMI_LOG="$TESTDIR/rmi.log"
  export MOCK_IMAGES="sha256:current|ghcr.io/pennstatecs/afct-dashboard:v0.1.9
sha256:mockimageid|ghcr.io/pennstatecs/afct-dashboard:v0.1.8
sha256:ancient|ghcr.io/pennstatecs/afct-dashboard:v0.1.4
sha256:oldnginx|ghcr.io/pennstatecs/afct-nginx:v0.1.4
sha256:pg|postgres:15-alpine"

  run sh install.sh update < /dev/null
  [ "$status" -eq 0 ]

  # Superseded AFCT images go...
  run grep -q 'afct-dashboard:v0.1.4' "$MOCK_RMI_LOG"; [ "$status" -eq 0 ]
  run grep -q 'afct-nginx:v0.1.4' "$MOCK_RMI_LOG"; [ "$status" -eq 0 ]
  # ...the rollback snapshot (mockimageid, what `image inspect` reports) stays...
  run grep -q 'afct-dashboard:v0.1.8' "$MOCK_RMI_LOG"; [ "$status" -ne 0 ]
  # ...and images we don't own are never touched.
  run grep -q 'postgres' "$MOCK_RMI_LOG"; [ "$status" -ne 0 ]
}

@test "a failed update prunes nothing" {
  write_complete_env
  export MOCK_RMI_LOG="$TESTDIR/rmi.log"
  export MOCK_IMAGES="sha256:ancient|ghcr.io/pennstatecs/afct-dashboard:v0.1.4"
  export MOCK_HEALTH="unhealthy"
  run sh install.sh update < /dev/null
  # Rolled back, so the old images are still needed.
  [ ! -s "$MOCK_RMI_LOG" ]
}

@test "update that comes up unhealthy fails after attempting rollback" {
  write_complete_env
  export MOCK_HEALTH="unhealthy"
  run sh install.sh update < /dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"rollback"* ]]
}

@test "doctor runs read-only and prints a result summary" {
  write_complete_env
  run sh install.sh doctor
  [[ "$output" == *"Doctor result:"* ]]
}

@test "version reports the deployment-tool version" {
  run sh install.sh version
  [ "$status" -eq 0 ]
  [[ "$output" == *"deployment tool version"* ]]
}

@test "recover restores the newest protected env backup" {
  write_complete_env
  cp .env.production .env.production.backup.20260101-000000.111
  rm .env.production
  run sh install.sh recover --yes
  [ "$status" -eq 0 ]
  [ -f .env.production ]
  [[ "$output" == *"restored"* ]]
}

# --- updater sidecar enable/disable --------------------------------------------

@test "--help lists the updater commands" {
  run sh install.sh --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"enable-updater"* ]]
  [[ "$output" == *"disable-updater"* ]]
}

@test "enable-updater sets the flag and starts the sidecar" {
  write_complete_env
  run sh install.sh enable-updater --yes
  [ "$status" -eq 0 ]
  run grep -q '^AFCT_UPDATER_ENABLED=true$' .env.production; [ "$status" -eq 0 ]
}

@test "--with-updater enables the sidecar during a fresh install" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  export MOCK_ARGS_LOG="$TESTDIR/args.log"
  run sh install.sh --non-interactive --with-updater < /dev/null
  [ "$status" -eq 0 ]
  run grep -q '^AFCT_UPDATER_ENABLED=true$' .env.production; [ "$status" -eq 0 ]
  # The profile is now carried on subsequent compose calls (e.g. the health probe).
  run grep -q -- '--profile updater' "$TESTDIR/args.log"; [ "$status" -eq 0 ]
}

@test "a fresh non-interactive install without --with-updater leaves the updater off" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -eq 0 ]
  run grep -q '^AFCT_UPDATER_ENABLED=true$' .env.production; [ "$status" -ne 0 ]
}

@test "--help documents --with-updater" {
  run sh install.sh --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"--with-updater"* ]]
}

@test "disable-updater clears the flag" {
  write_complete_env
  printf 'AFCT_UPDATER_ENABLED=true\n' >> .env.production
  run sh install.sh disable-updater
  [ "$status" -eq 0 ]
  run grep -q '^AFCT_UPDATER_ENABLED=false$' .env.production; [ "$status" -eq 0 ]
}

@test "operations include the updater profile only once enabled" {
  write_complete_env
  # Disabled by default: no profile flag passed.
  export MOCK_ARGS_LOG="$TESTDIR/args-off.log"
  run sh install.sh status
  run grep -q -- '--profile updater' "$TESTDIR/args-off.log"; [ "$status" -ne 0 ]

  # Enabled: every compose call carries the profile.
  printf 'AFCT_UPDATER_ENABLED=true\n' >> .env.production
  export MOCK_ARGS_LOG="$TESTDIR/args-on.log"
  run sh install.sh status
  run grep -q -- '--profile updater' "$TESTDIR/args-on.log"; [ "$status" -eq 0 ]
}

# --- dedicated service account -------------------------------------------------
#
# These opt into service mode (the shared setup disables it). The bats image runs as
# root and has busybox adduser, so a real 'afct' account is created; a runuser mock
# (mocks-service/) lets afctctl "run docker as afct" without a real login. In the new
# layout the service account owns the install root (/opt/afct = TESTDIR/opt) and the
# marker plus configuration live under shared/, so these use afctctl's default file
# locations rather than the cwd overrides the rest of the suite uses.

service_mode_env() {
  export AFCT_SERVICE_USER="afct"
  # Use the default in-prefix locations so ownership and the marker land where afctctl
  # (and a later run's marker detection) expect them: PREFIX/shared.
  unset AFCT_ENV_FILE AFCT_COMPOSE_FILE AFCT_LOG_FILE AFCT_ENV_EXAMPLE
  cp "$DEPLOY_DIR/docker-compose.yml" "$REL/docker-compose.yml" 2>/dev/null \
    || printf 'services: {}\n' > "$REL/docker-compose.yml"
  cp "$DEPLOY_DIR/.env.production.example" "$REL/.env.production.example" 2>/dev/null \
    || printf '# example\n' > "$REL/.env.production.example"
  chmod +x "$BATS_TEST_DIRNAME/mocks-service/"* 2>/dev/null || true
  PATH="$BATS_TEST_DIRNAME/mocks-service:$PATH"
  export PATH
}

# The service account's copy of a complete configuration, under shared/.
write_complete_env_shared() {
  write_complete_env
  mv .env.production "$TESTDIR/opt/shared/.env.production"
}

@test "a root install sets up the service account, marks it, and owns the install root" {
  service_mode_env
  export ADMIN_EMAIL="admin@example.com" ADMIN_PASSWORD="Str0ng!Pass1"
  export MOCK_ARGS_LOG="$TESTDIR/svc-args.log"
  run sh install.sh --non-interactive
  [ "$status" -eq 0 ]
  # The marker records the owning account so later runs re-enter service mode.
  _marker="$TESTDIR/opt/shared/.afct-service-user"
  [ -f "$_marker" ] || _marker="$TESTDIR/opt/.afct-service-user"
  [ -f "$_marker" ]
  run cat "$_marker"
  [ "$output" = "afct" ]
  # The configuration is owned by the service account, not root.
  run stat -c '%U' "$TESTDIR/opt/shared/.env.production"; [ "$output" = "afct" ]
  # Docker was actually driven (as the service account, via the runuser mock).
  run grep -Eq 'up +-d' "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
}

@test "a later run re-enters service mode from the marker" {
  service_mode_env
  adduser -S -H -s /sbin/nologin afct 2>/dev/null || true
  printf 'afct\n' > "$TESTDIR/opt/shared/.afct-service-user"
  write_complete_env_shared
  export MOCK_ARGS_LOG="$TESTDIR/svc-args2.log"
  run sh install.sh status
  [ "$status" -eq 0 ]
  # Service mode ran a docker command through the account (the runuser mock).
  [ -s "$MOCK_ARGS_LOG" ]
}

@test "--no-service-user installs as the current user even as root" {
  service_mode_env
  export ADMIN_EMAIL="admin@example.com" ADMIN_PASSWORD="Str0ng!Pass1"
  run sh install.sh --non-interactive --no-service-user
  [ "$status" -eq 0 ]
  # No service marker: this was a current-user install.
  [ ! -f "$TESTDIR/opt/shared/.afct-service-user" ]
  [ ! -f "$TESTDIR/opt/.afct-service-user" ]
}
