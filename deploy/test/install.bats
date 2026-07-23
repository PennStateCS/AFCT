#!/usr/bin/env bats
#
# Release-gate tests for deploy/install.sh. Docker is mocked (deploy/test/mocks),
# so these exercise the installer's own logic — argument parsing, the interactive /
# non-interactive split, config writing, the operational commands, and the failure
# paths — without a daemon. Run: bats deploy/test/install.bats

setup() {
  DEPLOY_DIR="$BATS_TEST_DIRNAME/.."
  TESTDIR="$(mktemp -d)"
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

  cd "$TESTDIR"
}

teardown() {
  [ -n "${TESTDIR:-}" ] && rm -rf "$TESTDIR"
}

# A complete managed configuration, as the installer would have written it.
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
EOF
  chmod 600 .env.production
}

# --- CLI surface ---------------------------------------------------------------

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

@test "self-update refreshes the deploy files and never touches .env.production" {
  write_complete_env
  _env_before=$(cat .env.production)
  # The 'downloaded' files carry a marker so we can confirm they replaced the originals.
  export MOCK_CURL_BODY='#!/bin/sh
# refreshed-by-self-update
exit 0'
  # The compose download is served separately (and must look like a Compose file).
  export MOCK_COMPOSE_BODY='services: {}
# refreshed-by-self-update'
  run sh install.sh self-update
  [ "$status" -eq 0 ]
  [[ "$output" == *"Updated:"* ]]
  # The secrets file is byte-for-byte untouched.
  [ "$(cat .env.production)" = "$_env_before" ]
  # The compose file now holds the refreshed content.
  run grep -q "refreshed-by-self-update" docker-compose.yml
  [ "$status" -eq 0 ]
  # The previous installer was backed up before being replaced.
  run sh -c 'ls install.sh.backup.* >/dev/null 2>&1'
  [ "$status" -eq 0 ]
}

@test "self-update refuses an empty download and keeps the current installer" {
  write_complete_env
  cp install.sh install.sh.orig
  export MOCK_CURL_BODY=''        # simulate a truncated/empty download
  run sh install.sh self-update
  [ "$status" -ne 0 ]
  [[ "$output" == *"invalid"* ]]
  # The working installer was not clobbered by the bad download.
  run cmp -s install.sh install.sh.orig
  [ "$status" -eq 0 ]
}

@test "self-update refuses a compose file that is not a Compose file" {
  write_complete_env
  cp docker-compose.yml docker-compose.yml.orig
  export MOCK_COMPOSE_BODY='this is not compose'
  run sh install.sh self-update
  [ "$status" -ne 0 ]
  [[ "$output" == *"compose file is invalid"* ]]
  run cmp -s docker-compose.yml docker-compose.yml.orig
  [ "$status" -eq 0 ]
}

@test "doctor runs read-only and prints a result summary" {
  write_complete_env
  run sh install.sh doctor
  [[ "$output" == *"Doctor result:"* ]]
}

@test "version reports the installer version" {
  run sh install.sh version
  [ "$status" -eq 0 ]
  [[ "$output" == *"installer version: 2.1.1"* ]]
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
