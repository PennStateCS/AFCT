#!/usr/bin/env bats
#
# Release-gate tests for deploy/install.sh. Docker is mocked (deploy/test/mocks),
# so these exercise the installer's own logic — argument parsing, the interactive /
# non-interactive split, config writing, and the failure paths — without a daemon.
# Run: bats deploy/test/install.bats

setup() {
  DEPLOY_DIR="$BATS_TEST_DIRNAME/.."
  TESTDIR="$(mktemp -d)"
  cp "$DEPLOY_DIR/install.sh" "$TESTDIR/install.sh"
  # A compose file must exist for `-f docker-compose.yml`; the mock ignores contents.
  cp "$DEPLOY_DIR/docker-compose.yml" "$TESTDIR/docker-compose.yml" 2>/dev/null \
    || printf 'services: {}\n' > "$TESTDIR/docker-compose.yml"

  # Mocks first on PATH so `docker`, `sleep`, `curl`, `systemctl` are the fakes.
  chmod +x "$BATS_TEST_DIRNAME/mocks/"* 2>/dev/null || true
  PATH="$BATS_TEST_DIRNAME/mocks:$PATH"
  export PATH

  # A sane default scenario; individual tests override.
  export MOCK_HEALTH="healthy"
  export APP_URL="https://afct.test"

  cd "$TESTDIR"
}

teardown() {
  [ -n "${TESTDIR:-}" ] && rm -rf "$TESTDIR"
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
  [[ "$output" == *"ADMIN_PASSWORD is required"* ]]
}

@test "--non-interactive with all values writes a complete .env.production and succeeds" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -eq 0 ]
  run grep -Eq '^POSTGRES_PASSWORD=.+' .env.production; [ "$status" -eq 0 ]
  run grep -Eq '^DATABASE_URL=postgresql://' .env.production; [ "$status" -eq 0 ]
  run grep -Eq '^ADMIN_EMAIL=admin@example.com$' .env.production; [ "$status" -eq 0 ]
  run grep -Eq '^NEXTAUTH_SECRET=.+' .env.production; [ "$status" -eq 0 ]
}

# --- security: the generated admin password must not leak into the log ----------

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

# --- failure paths are fatal ---------------------------------------------------

@test "a failed image pull is fatal" {
  export ADMIN_EMAIL="admin@example.com"
  export ADMIN_PASSWORD="Str0ng!Pass1"
  export MOCK_PULL_RC=42
  run sh install.sh --non-interactive < /dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"could not download"* ]]
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
  [[ "$output" == *"health check"* ]]
  [[ "$output" != *"AFCT Dashboard is starting."* ]]
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
  [[ "$output" == *"application container was not created"* ]]
}
