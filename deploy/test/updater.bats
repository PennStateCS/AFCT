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
  export UPDATER_COMPOSE_BASE_URL=""                      # offline: don't fetch a release compose unless a test opts in
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

@test "a valid upgrade writes a live progress log the UI can stream" {
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"prog1","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  # The append-only progress log captured the milestone notes the UI tails.
  [ -s "$TESTDIR/triggers/progress.log" ]
  run grep -q 'starting upgrade v1.0.0 -> v1.1.0' "$TESTDIR/triggers/progress.log"; [ "$status" -eq 0 ]
  run grep -q 'recreating containers' "$TESTDIR/triggers/progress.log"; [ "$status" -eq 0 ]
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

@test "self-update pulls the updater image and hands off to a detached helper" {
  export MOCK_ARGS_LOG="$TESTDIR/docker-args.log"
  request '{"action":"self-update","tag":"v1.1.0","requestId":"su1"}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  [[ "$(jq -r '.message' triggers/status.json)" == *"update service updated to v1.1.0"* ]]
  # It pulled the updater service...
  run grep -Eq 'pull +updater' "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
  # ...and spawned a detached helper (docker run) to recreate it.
  run grep -Eq '^run .*-d' "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
  # The recreate must run compose FROM the real host deploy dir (the mock reports
  # /host/afct), mounted at its own path, so the relative `.:/afct` mount and the
  # services' relative env_file both resolve there instead of a bare /afct.
  run grep -q -- "cd '/host/afct'" "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
  run grep -q -- '-v /host/afct:/host/afct' "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
  # A self-update must not touch the app's version pin.
  [ "$(tag_now)" = "v1.0.0" ]
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

@test "a permanently unhealthy upgrade rolls the tag back" {
  export MOCK_HEALTH="unhealthy"
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"r8","backupFirst":false}'
  run sh updater.sh
  # Health never passes for either tag in the mock, so the gate exhausts its timeout,
  # the env is restored to the original, and the final phase reflects the rollback.
  [ "$(tag_now)" = "v1.0.0" ]
  [[ "$(phase)" == "rolled_back" || "$(phase)" == "failed" ]]
}

@test "an app that is unhealthy then recovers is NOT rolled back" {
  # Model a slow cold boot: unhealthy for the first two health polls, healthy after.
  # The gate must keep the new tag rather than roll back on the first unhealthy read.
  export MOCK_HEALTH_FLIP_AT=3
  export MOCK_HEALTH_COUNT_FILE="$TESTDIR/hc"
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"r9","backupFirst":false}'
  run sh updater.sh
  [ "$(tag_now)" = "v1.1.0" ]
  [ "$(phase)" = "healthy" ]
}

@test "a failed image pull rolls back" {
  export MOCK_PULL_RC=1
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"r9","backupFirst":false}'
  run sh updater.sh
  [ "$(tag_now)" = "v1.0.0" ]
  [[ "$(phase)" == "rolled_back" || "$(phase)" == "failed" ]]
}

@test "an upgrade is refused up-front when the disk is too small for the image" {
  # The real failure this guards: the pull dies part-way with "no space left on
  # device", the upgrade rolls back, and the log says only "failed". Requiring an
  # impossible amount of free space exercises the pre-flight check.
  export UPDATER_DISK_MIN_MB=99999999
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"disk1","backupFirst":false}'
  run sh updater.sh
  [ "$status" -eq 0 ]
  [ "$(phase)" = "failed" ]
  # Nothing was touched: the running version is still pinned.
  [ "$(tag_now)" = "v1.0.0" ]
  # The message has to be actionable, not just "failed".
  run jq -r '.message' triggers/status.json
  [[ "$output" == *"disk space"* ]]
}

@test "a successful upgrade prunes superseded images but keeps the rollback target" {
  export MOCK_RMI_LOG="$TESTDIR/rmi.log"
  export MOCK_IMAGES="ghcr.io/pennstatecs/afct-dashboard:v1.1.0
ghcr.io/pennstatecs/afct-dashboard:v1.0.0
ghcr.io/pennstatecs/afct-dashboard:v0.9.0
ghcr.io/pennstatecs/afct-nginx:v0.9.0
postgres:15-alpine
ghcr.io/pennstatecs/afct-updater:v1.0.0"

  request '{"action":"upgrade","tag":"v1.1.0","requestId":"prune1","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]

  # Superseded versions of our images are removed...
  run grep -q 'afct-dashboard:v0.9.0' "$MOCK_RMI_LOG"; [ "$status" -eq 0 ]
  run grep -q 'afct-nginx:v0.9.0' "$MOCK_RMI_LOG"; [ "$status" -eq 0 ]
  # ...but the new version and the rollback target survive...
  run grep -q 'afct-dashboard:v1.1.0' "$MOCK_RMI_LOG"; [ "$status" -ne 0 ]
  run grep -q 'afct-dashboard:v1.0.0' "$MOCK_RMI_LOG"; [ "$status" -ne 0 ]
  # ...and images we don't own are never touched.
  run grep -q 'postgres' "$MOCK_RMI_LOG"; [ "$status" -ne 0 ]
  run grep -q 'afct-updater' "$MOCK_RMI_LOG"; [ "$status" -ne 0 ]
}

@test "a failed upgrade prunes nothing" {
  export MOCK_RMI_LOG="$TESTDIR/rmi.log"
  export MOCK_IMAGES="ghcr.io/pennstatecs/afct-dashboard:v0.9.0"
  export MOCK_HEALTH="unhealthy"
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"prune2","backupFirst":false}'
  run sh updater.sh
  # Rolled back, so the old images are still needed.
  [ ! -s "$MOCK_RMI_LOG" ]
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

# Fulfill a backup request: create a new backup archive when backup-now shows up.
# The extension defaults to the current bundle format (tar.gz); pass a second arg to
# exercise a legacy dump.
serve_backup() {
  _ext=${2:-tar.gz}
  ( _i=0
    while [ "$_i" -lt 800 ]; do
      [ -f backup-triggers/backup-now ] && { : > "backups/afct-$1.${_ext}"; break; }
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
  # The backup sidecar writes the current archive format (afct-<ts>.tar.gz); the
  # updater must detect that, not just the legacy .dump, or it waits out the whole
  # backup timeout and never records a restore point.
  export UPDATER_BACKUP_TIMEOUT=20
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"u1","backupFirst":true}'
  serve_backup "20260202-000000"; watcher=$!
  run sh updater.sh
  kill "$watcher" 2>/dev/null || true
  [ "$(phase)" = "healthy" ]
  run jq -e '.[] | select(.version=="v1.0.0" and .backup=="20260202-000000")' triggers/restore-points.json
  [ "$status" -eq 0 ]
  # The backup phase streams progress so the UI doesn't look stalled on the longest step.
  run grep -q 'backing up the database' "$TESTDIR/triggers/progress.log"; [ "$status" -eq 0 ]
  run grep -q 'database backup complete' "$TESTDIR/triggers/progress.log"; [ "$status" -eq 0 ]
}

@test "a legacy .dump backup is still detected and recorded" {
  export UPDATER_BACKUP_TIMEOUT=20
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"u2","backupFirst":true}'
  serve_backup "20260203-000000" dump; watcher=$!
  run sh updater.sh
  kill "$watcher" 2>/dev/null || true
  [ "$(phase)" = "healthy" ]
  run jq -e '.[] | select(.version=="v1.0.0" and .backup=="20260203-000000")' triggers/restore-points.json
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

@test "the updater stamps its version from the image tag when there's no version label" {
  # MOCK_NO_PROJECT makes the mock's label lookup return empty, so the stamp must fall
  # back to the tag in the image ref (ghcr.io/example/afct:latest -> latest).
  export MOCK_NO_PROJECT=1
  run sh updater.sh
  [ "$status" -eq 0 ]
  [ -s "$TESTDIR/triggers/updater.version" ]
  run cat "$TESTDIR/triggers/updater.version"
  [ "$output" = "latest" ]
}

@test "the updater stamps a presence heartbeat in the shared trigger volume" {
  # The app (no Docker access) reads this to know the sidecar is installed/running.
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"p1","backupFirst":false}'
  run sh updater.sh
  [ "$status" -eq 0 ]
  [ -s "$TESTDIR/triggers/updater.alive" ]                 # a value was written
  run grep -Eq '^[0-9]+$' "$TESTDIR/triggers/updater.alive"; [ "$status" -eq 0 ]  # an epoch
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

# --- delete a restore point ---------------------------------------------------- #

@test "delete-restore-point removes the entry and its backup files" {
  printf '[{"version":"v0.9.0","backup":"20260101-000000"},{"version":"v1.0.0","backup":"20260202-000000"}]\n' > triggers/restore-points.json
  : > backups/afct-20260101-000000.tar.gz
  : > backups/afct-files-20260101-000000.tgz
  request '{"action":"delete-restore-point","requestId":"del1","restorePoint":"20260101-000000"}'
  run sh updater.sh
  [ "$status" -eq 0 ]
  # The chosen entry is gone; the other is kept.
  run jq -e 'any(.[]?; .backup=="20260101-000000")' triggers/restore-points.json; [ "$status" -ne 0 ]
  run jq -e 'any(.[]?; .backup=="20260202-000000")' triggers/restore-points.json; [ "$status" -eq 0 ]
  # Its backup artifacts are deleted (disk reclaimed).
  [ ! -f backups/afct-20260101-000000.tar.gz ]
  [ ! -f backups/afct-files-20260101-000000.tgz ]
}

@test "delete-restore-point ignores an unrecorded restore point" {
  printf '[{"version":"v1.0.0","backup":"20260202-000000"}]\n' > triggers/restore-points.json
  : > backups/afct-19990101-000000.tar.gz
  request '{"action":"delete-restore-point","requestId":"del2","restorePoint":"19990101-000000"}'
  run sh updater.sh
  [ "$status" -eq 0 ]
  # A backup that isn't a recorded restore point is never deleted (no arbitrary rm).
  [ -f backups/afct-19990101-000000.tar.gz ]
  run jq -e 'any(.[]?; .backup=="20260202-000000")' triggers/restore-points.json; [ "$status" -eq 0 ]
}

# --- compose-from-release (a release that changed the stack layout) ------------ #

@test "an upgrade applies a changed release compose from the release tag ref" {
  export UPDATER_COMPOSE_BASE_URL="https://raw.githubusercontent.com/PennStateCS/AFCT"
  export MOCK_COMPOSE_BODY='services:\n  app: {}\n  worker: {}\n'
  printf 'services: {}\n' > docker-compose.yml   # current on-disk stack differs from the release
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"c1","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  # The release compose (fetched from the v1.1.0 tag ref) is now installed.
  run grep -q 'worker:' docker-compose.yml; [ "$status" -eq 0 ]
  run grep -q 'updated the stack configuration for v1.1.0' "$TESTDIR/triggers/progress.log"; [ "$status" -eq 0 ]
}

@test "an unchanged release compose is left in place with no backup churn" {
  export UPDATER_COMPOSE_BASE_URL="https://raw.githubusercontent.com/PennStateCS/AFCT"
  export MOCK_COMPOSE_BODY='services: {}'
  printf 'services: {}' > docker-compose.yml     # identical to what the release ships
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"c2","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  run grep -q 'updated the stack configuration' "$TESTDIR/triggers/progress.log"; [ "$status" -ne 0 ]
  # No .bak.* backup files were left behind in the deploy dir.
  run sh -c 'ls docker-compose.yml.bak.* 2>/dev/null'; [ "$status" -ne 0 ]
}

@test "a release compose that fails validation is not applied" {
  export UPDATER_COMPOSE_BASE_URL="https://raw.githubusercontent.com/PennStateCS/AFCT"
  export MOCK_COMPOSE_BODY='services:\n  app: {}\n  worker: {}\n'
  export MOCK_CONFIG_RC=1                         # candidate fails `compose config`
  printf 'services: {}\n' > docker-compose.yml
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"c3","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  # The bad candidate was rejected; the current stack file is untouched.
  run grep -q 'worker:' docker-compose.yml; [ "$status" -ne 0 ]
  run grep -q 'failed validation' "$TESTDIR/triggers/progress.log"; [ "$status" -eq 0 ]
}

@test "a failed upgrade restores the previous compose file" {
  export UPDATER_COMPOSE_BASE_URL="https://raw.githubusercontent.com/PennStateCS/AFCT"
  export MOCK_COMPOSE_BODY='services:\n  app: {}\n  worker: {}\n'
  export MOCK_HEALTH="unhealthy"                  # new stack never becomes healthy
  printf 'services: {}\n' > docker-compose.yml
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"c4","backupFirst":false}'
  run sh updater.sh
  [[ "$(phase)" == "rolled_back" || "$(phase)" == "failed" ]]
  # Rollback reverted the stack file to the pre-upgrade one (no worker service).
  run grep -q 'worker:' docker-compose.yml; [ "$status" -ne 0 ]
}
