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
