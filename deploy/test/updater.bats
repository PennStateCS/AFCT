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
  export UPDATER_MANIFEST_URL=""                          # offline: validate against the local file only
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

@test "an upgrade recreates the app and its lockstep sidecars but not the updater" {
  export MOCK_UP_LOG="$TESTDIR/up.log"
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"ls1","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  run grep -q 'app' "$TESTDIR/up.log"; [ "$status" -eq 0 ]
  run grep -q 'nginx' "$TESTDIR/up.log"; [ "$status" -eq 0 ]
  run grep -q 'db-backup' "$TESTDIR/up.log"; [ "$status" -eq 0 ]
  # The updater must never recreate its own container.
  run grep -q 'updater' "$TESTDIR/up.log"; [ "$status" -ne 0 ]
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

# --- downgrade-by-restore ------------------------------------------------------
# The backup sidecar is mocked by a tiny background watcher that fulfills the
# updater's trigger files (a fresh dump for a backup, an "ok"/"failed" result for a
# restore) the moment they appear.

# These background shells stand in for the backup sidecar: they answer the
# updater's trigger files the moment they appear. The loop is long-lived and polls
# tightly on purpose — a real reply lands in ~0.05s, but on a loaded CI runner this
# background shell can be starved of CPU for several seconds, so the window must be
# far wider than the updater's own timeout. (The original fixed 10s lifetime raced
# an 8s restore timeout and flaked when the runner was busy.) The paired timeouts in
# the tests below are set to 20s for the same reason; both only bound the
# pathological case, they don't slow the normal path.

# Fulfill a backup request: create a new dump when backup-now shows up.
serve_backup() {
  ( _i=0
    while [ "$_i" -lt 800 ]; do
      [ -f backup-triggers/backup-now ] && { : > "backups/afct-$1.dump"; break; }
      _i=$((_i + 1)); sleep 0.05
    done ) &
}
# Fulfill a restore request with the given result word (ok|failed).
serve_restore() {
  ( _i=0
    while [ "$_i" -lt 800 ]; do
      [ -f backup-triggers/restore-now ] && { printf '%s\n' "$1" > backup-triggers/restore-result; break; }
      _i=$((_i + 1)); sleep 0.05
    done ) &
}

@test "a successful upgrade records a restore point for the version left behind" {
  export UPDATER_BACKUP_TIMEOUT=20
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"u1","backupFirst":true}'
  serve_backup "20260202-000000"; watcher=$!
  run sh updater.sh
  kill "$watcher" 2>/dev/null || true
  [ "$(phase)" = "healthy" ]
  run jq -e '.[] | select(.version=="v1.0.0" and .backup=="20260202-000000")' triggers/restore-points.json
  [ "$status" -eq 0 ]
}

@test "downgrade restores the database and switches to the old version" {
  printf '[{"version":"v0.9.0","backup":"20260101-000000","createdAt":"x"}]\n' > triggers/restore-points.json
  : > backups/afct-20260101-000000.dump
  export UPDATER_BACKUP_TIMEOUT=2 UPDATER_RESTORE_TIMEOUT=20
  request '{"action":"downgrade","tag":"v0.9.0","requestId":"d1","restorePoint":"20260101-000000"}'
  serve_restore "ok 20260101-000000"; watcher=$!
  run sh updater.sh
  kill "$watcher" 2>/dev/null || true
  [ "$(phase)" = "healthy" ]
  [ "$(tag_now)" = "v0.9.0" ]
}

@test "the updater stamps a liveness heartbeat the healthcheck can read" {
  export UPDATER_HEARTBEAT_FILE="$TESTDIR/heartbeat"
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"hb1","backupFirst":false}'
  run sh updater.sh
  [ "$status" -eq 0 ]
  [ -s "$TESTDIR/heartbeat" ]                              # a value was written
  run grep -Eq '^[0-9]+$' "$TESTDIR/heartbeat"; [ "$status" -eq 0 ]   # an epoch
}

@test "downgrade rejects a restore point that is not recorded" {
  printf '[]\n' > triggers/restore-points.json
  request '{"action":"downgrade","tag":"v0.9.0","requestId":"d2","restorePoint":"20260101-000000"}'
  run sh updater.sh
  [ "$(phase)" = "failed" ]
  [ "$(tag_now)" = "v1.0.0" ]     # unchanged
}

@test "downgrade fails cleanly if the restore does not succeed" {
  printf '[{"version":"v0.9.0","backup":"20260101-000000","createdAt":"x"}]\n' > triggers/restore-points.json
  : > backups/afct-20260101-000000.dump
  export UPDATER_BACKUP_TIMEOUT=2 UPDATER_RESTORE_TIMEOUT=20
  request '{"action":"downgrade","tag":"v0.9.0","requestId":"d3","restorePoint":"20260101-000000"}'
  serve_restore "failed restore-error"; watcher=$!
  run sh updater.sh
  kill "$watcher" 2>/dev/null || true
  [ "$(phase)" = "failed" ]
  [ "$(tag_now)" = "v1.0.0" ]     # tag not switched when the restore fails
}
