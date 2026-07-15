#!/usr/bin/env bats
#
# Release-gate tests for docker/updater/updater.sh. Docker is mocked
# (deploy/test/mocks) and the updater runs in one-shot mode (UPDATER_ONCE=true),
# so these exercise the request validation, tag/version logic, the env rewrite,
# health handling, and rollback without a daemon. Requires jq (preinstalled on
# GitHub ubuntu runners). Run: bats deploy/test/updater.bats

setup() {
  DEPLOY_DIR="$BATS_TEST_DIRNAME/.."
  UPDATER="$DEPLOY_DIR/../docker/updater/updater.sh"
  TESTDIR="$(mktemp -d)"
  cp "$UPDATER" "$TESTDIR/updater.sh"
  cp "$DEPLOY_DIR/docker-compose.yml" "$TESTDIR/docker-compose.yml" 2>/dev/null \
    || printf 'services: {}\n' > "$TESTDIR/docker-compose.yml"

  mkdir -p "$TESTDIR/triggers" "$TESTDIR/backups" "$TESTDIR/backup-triggers"
  printf 'NODE_ENV=production\nAFCT_APP_TAG=v1.0.0\nNEXTAUTH_SECRET=keepme\n' > "$TESTDIR/.env.production"

  chmod +x "$BATS_TEST_DIRNAME/mocks/"* 2>/dev/null || true
  PATH="$BATS_TEST_DIRNAME/mocks:$PATH"
  export PATH

  export UPDATER_ONCE=true
  export UPDATER_TRIGGER_DIR="$TESTDIR/triggers"
  export UPDATER_COMPOSE_FILE="$TESTDIR/docker-compose.yml"
  export UPDATER_ENV_FILE="$TESTDIR/.env.production"
  export UPDATER_MANIFEST_FILE="$TESTDIR/versions.json"   # absent unless a test writes it
  export UPDATER_BACKUP_DIR="$TESTDIR/backups"
  export BACKUP_TRIGGER_DIR="$TESTDIR/backup-triggers"
  export UPDATER_HEALTH_TIMEOUT=6
  export UPDATER_HEALTH_INTERVAL=1
  export UPDATER_BACKUP_TIMEOUT=2
  export MOCK_HEALTH="healthy"

  cd "$TESTDIR"
}

teardown() {
  [ -n "${TESTDIR:-}" ] && rm -rf "$TESTDIR"
}

request() { printf '%s' "$1" > "$TESTDIR/triggers/request.json"; }
phase()   { jq -r '.phase' "$TESTDIR/triggers/status.json"; }
tag_now() { sed -n 's/^AFCT_APP_TAG=//p' "$TESTDIR/.env.production"; }

@test "a valid upgrade swaps the tag and reports healthy" {
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"r1","backupFirst":false}'
  run sh updater.sh
  [ "$status" -eq 0 ]
  [ "$(tag_now)" = "v1.1.0" ]
  [ "$(phase)" = "healthy" ]
  # Unrelated env lines are preserved.
  run grep -q '^NEXTAUTH_SECRET=keepme$' .env.production; [ "$status" -eq 0 ]
}

@test "an invalid tag is rejected and the version is unchanged" {
  request '{"action":"upgrade","tag":"bad tag!","requestId":"r2","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "failed" ]
  [ "$(tag_now)" = "v1.0.0" ]
}

@test "an unsupported action is rejected" {
  request '{"action":"delete-everything","tag":"v1.1.0","requestId":"r3"}'
  run sh updater.sh
  [ "$(phase)" = "failed" ]
  [ "$(tag_now)" = "v1.0.0" ]
}

@test "requesting the current version is a no-op reported healthy" {
  request '{"action":"upgrade","tag":"v1.0.0","requestId":"r4","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  [ "$(tag_now)" = "v1.0.0" ]
}

@test "the curated manifest is authoritative when present" {
  printf '{"versions":[{"tag":"v1.1.0"}]}\n' > versions.json
  request '{"action":"upgrade","tag":"v9.9.9","requestId":"r5","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "failed" ]                 # v9.9.9 not in the manifest
  [ "$(tag_now)" = "v1.0.0" ]

  request '{"action":"upgrade","tag":"v1.1.0","requestId":"r6","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]                # v1.1.0 is listed
  [ "$(tag_now)" = "v1.1.0" ]
}

@test "a missing app container fails without changing the version" {
  export MOCK_NO_PROJECT=1
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"r7","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "failed" ]
  [[ "$(jq -r '.message' triggers/status.json)" == *"app container"* ]]
  [ "$(tag_now)" = "v1.0.0" ]
}

@test "an unhealthy upgrade rolls the tag back" {
  export MOCK_HEALTH="unhealthy"
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"r8","backupFirst":false}'
  run sh updater.sh
  # Health never passes for either tag in the mock, so the env is restored to the
  # original and the final phase reflects the failed upgrade+rollback.
  [ "$(tag_now)" = "v1.0.0" ]
  [[ "$(phase)" == "rolled_back" || "$(phase)" == "failed" ]]
}

@test "a failed image pull rolls back" {
  export MOCK_PULL_RC=1
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"r9","backupFirst":false}'
  run sh updater.sh
  [ "$(tag_now)" = "v1.0.0" ]
  [[ "$(phase)" == "rolled_back" || "$(phase)" == "failed" ]]
}

@test "backup-first is best-effort: an unconfirmed backup still upgrades" {
  # No backup sidecar in the harness, so no new dump appears within the timeout.
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"r10","backupFirst":true}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  [ "$(tag_now)" = "v1.1.0" ]
  # The updater still asked the backup sidecar for a backup.
  [ -f backup-triggers/backup-now ]
}
