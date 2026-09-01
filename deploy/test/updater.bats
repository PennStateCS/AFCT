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
  # Stage 2 knobs: no stability wait and single-attempt pulls/fetches by default, so the
  # existing tests stay fast; the Stage 2 tests below opt into non-zero values.
  export UPDATER_STABILITY_SECONDS=0
  export UPDATER_PULL_RETRIES=1
  export UPDATER_PULL_RETRY_DELAY=0
  export UPDATER_FETCH_RETRIES=1
  export UPDATER_FETCH_RETRY_DELAY=0
  # Stage 3: these tests run offline (no manifest URL, usually no local versions.json), so
  # allow character-safe tags by default. The fail-closed behaviour is exercised explicitly
  # by the P4 tests, which set this false.
  export UPDATER_ALLOW_UNVERIFIED_TAGS=true
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

@test "self-update pulls the updater image, hands off, and awaits confirmation (not premature success)" {
  export MOCK_ARGS_LOG="$TESTDIR/docker-args.log"
  request '{"action":"self-update","tag":"v1.1.0","requestId":"su1"}'
  run sh updater.sh
  # It does NOT report healthy up front; it stays in the in-flight self_updating phase and
  # drops a pending marker for the replacement updater to confirm.
  [ "$(phase)" = "self_updating" ]
  [[ "$(jq -r '.message' triggers/status.json)" == *"restarting the update service"* ]]
  [ -f "$TESTDIR/triggers/.self-update-pending.json" ]
  run jq -e '.tag == "v1.1.0"' "$TESTDIR/triggers/.self-update-pending.json"; [ "$status" -eq 0 ]
  # It pulled the updater service...
  run grep -Eq 'pull +updater' "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
  # ...and spawned a detached helper (docker run) to recreate it.
  run grep -Eq '^run .*-d' "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
  # The recreate mounts the runtime compose and shared directories at their real host
  # paths (the mock reports /host/afct for both) and drives compose with ABSOLUTE
  # --env-file / -f paths, so no path depends on the helper's working directory. It also
  # exports AFCT_RUNTIME_ENV_FILE so the services' env_file resolves inside the helper.
  run grep -q -- '-v /host/afct:/host/afct' "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
  run grep -q -- "-f '/host/afct/docker-compose.yml'" "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
  run grep -q -- "--env-file '/host/afct/.env.production'" "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
  run grep -q -- "AFCT_RUNTIME_ENV_FILE='/host/afct/.env.production'" "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
  # A self-update must not touch the app's version pin.
  [ "$(tag_now)" = "v1.0.0" ]
}

@test "self-update carries the compose and shared directories into the replacement" {
  # The versioned Linux layout keeps the runtime compose file in a SUBDIRECTORY of the
  # shared config directory. The Compose file builds the updater's own mounts from
  # AFCT_RUNTIME_COMPOSE_DIR / AFCT_RUNTIME_SHARED_DIR, so if the swap helper does not
  # export both, they fall back to `.` and the replacement comes back with /afct-shared
  # bound to the runtime directory: it can no longer find .env.production, and every
  # later upgrade fails until a host-side update recreates it.
  export MOCK_ARGS_LOG="$TESTDIR/docker-args.log"
  export MOCK_AFCT_COMPOSE_MOUNT=/opt/afct/shared/runtime
  export MOCK_AFCT_SHARED_MOUNT=/opt/afct/shared
  request '{"action":"self-update","tag":"v1.1.0","requestId":"su3"}'
  run sh updater.sh

  run grep -q -- "AFCT_RUNTIME_COMPOSE_DIR='/opt/afct/shared/runtime'" "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
  run grep -q -- "AFCT_RUNTIME_SHARED_DIR='/opt/afct/shared'" "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
  # The env file comes from the shared directory, not the runtime one.
  run grep -q -- "AFCT_RUNTIME_ENV_FILE='/opt/afct/shared/.env.production'" "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
  # Both host directories are mounted at their real paths so the helper resolves them.
  run grep -q -- '-v /opt/afct/shared/runtime:/opt/afct/shared/runtime' "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
  run grep -q -- '-v /opt/afct/shared:/opt/afct/shared' "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
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

@test "downgrade takes a safety backup, restores the database, and switches version" {
  printf '[{"version":"v0.9.0","backup":"20260101-000000","createdAt":"x"}]\n' > triggers/restore-points.json
  : > backups/afct-20260101-000000.dump
  # Backdate the existing restore-point backup so the new safety snapshot (written during
  # the run) is unambiguously newer; otherwise same-second mtimes make it undetectable.
  touch -t 202601010000 backups/afct-20260101-000000.dump
  export UPDATER_BACKUP_TIMEOUT=20 UPDATER_RESTORE_TIMEOUT=20
  request '{"action":"downgrade","tag":"v0.9.0","requestId":"d1","restorePoint":"20260101-000000"}'
  # A downgrade first snapshots the current state (so it is reversible), then restores.
  serve_backup "20260115-120000"; b=$!
  serve_restore "ok 20260101-000000"; r=$!
  run sh updater.sh
  kill "$b" "$r" 2>/dev/null || true
  [ "$(phase)" = "healthy" ]
  [ "$(tag_now)" = "v0.9.0" ]
  # The pre-downgrade safety snapshot is recorded as a restore point for the version left.
  run jq -e '.[] | select(.version=="v1.0.0" and .backup=="20260115-120000")' triggers/restore-points.json
  [ "$status" -eq 0 ]
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
  touch -t 202601010000 backups/afct-20260101-000000.dump
  export UPDATER_BACKUP_TIMEOUT=20 UPDATER_RESTORE_TIMEOUT=20
  request '{"action":"downgrade","tag":"v0.9.0","requestId":"d3","restorePoint":"20260101-000000"}'
  # The safety backup succeeds; the restore itself is what fails here.
  serve_backup "20260116-120000"; b=$!
  serve_restore "failed restore-error"; r=$!
  run sh updater.sh
  kill "$b" "$r" 2>/dev/null || true
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

# --- durable transaction, interrupted-upgrade recovery, local-image rollback --------- #
# These seed a transaction.json (the durable state a crash would leave) and run the
# updater fresh, so its startup recovery has to decide from the recorded state plus the
# actual (mocked) docker state, not from the env file's tag alone.

txn() { printf '%s' "$1" > "$TESTDIR/triggers/transaction.json"; }

@test "an upgrade records a durable transaction and clears it on success without a write error" {
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"txn1","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  # The transaction is removed once the upgrade commits, and it serialized cleanly.
  [ ! -f "$TESTDIR/triggers/transaction.json" ]
  [[ "$output" != *"could not write the transaction file"* ]]
}

@test "recovery commits an interrupted upgrade that actually came up healthy" {
  # env already flipped to the new tag and the container is on the new image + healthy:
  # a crash right after the swap must be committed, not rolled back over a good version.
  printf 'NODE_ENV=production\nAFCT_APP_TAG=v1.1.0\nNEXTAUTH_SECRET=keepme\n' > .env.production
  txn '{"schema":"afct-update-txn/v1","action":"upgrade","phase":"verifying","fromTag":"v1.0.0","toTag":"v1.1.0","project":"afct","requestId":"rec1","images":{"app":"sha256:img-v1.0.0"},"envChanged":true,"composeReplaced":false,"composeBackup":"","committed":false}'
  export MOCK_DEPLOYED_TAG=v1.1.0
  export MOCK_HEALTH=healthy
  run sh updater.sh
  [ "$status" -eq 0 ]
  [ "$(phase)" = "healthy" ]
  [ "$(tag_now)" = "v1.1.0" ]
  [ ! -f "$TESTDIR/triggers/transaction.json" ]
}

@test "recovery rolls back an interrupted upgrade whose new version never came up (env tag and running image disagree)" {
  # env pins v1.1.0 but the running container is still on v1.0.0's image: the upgrade did
  # not finish, so recovery must return the env to the known-good version.
  printf 'NODE_ENV=production\nAFCT_APP_TAG=v1.1.0\nNEXTAUTH_SECRET=keepme\n' > .env.production
  txn '{"schema":"afct-update-txn/v1","action":"upgrade","phase":"recreating","fromTag":"v1.0.0","toTag":"v1.1.0","project":"afct","requestId":"rec2","images":{"app":"sha256:img-v1.0.0"},"envChanged":true,"composeReplaced":false,"composeBackup":"","committed":false}'
  export MOCK_DEPLOYED_TAG=v1.0.0    # still on the old image
  export MOCK_HEALTH=healthy         # the old version is healthy, so rollback is clean
  run sh updater.sh
  [ "$status" -eq 0 ]
  [ "$(phase)" = "rolled_back" ]
  [ "$(tag_now)" = "v1.0.0" ]
  [ ! -f "$TESTDIR/triggers/transaction.json" ]
}

@test "recovery restores the previous compose file when the interrupted upgrade replaced it" {
  printf 'services:\n  app: {}\n  worker: {}\n' > docker-compose.yml     # the new (failed) stack
  printf 'services: {}\n' > docker-compose.yml.bak.rec3                   # the pre-upgrade file
  printf 'NODE_ENV=production\nAFCT_APP_TAG=v1.1.0\nNEXTAUTH_SECRET=keepme\n' > .env.production
  txn "{\"schema\":\"afct-update-txn/v1\",\"action\":\"upgrade\",\"phase\":\"verifying\",\"fromTag\":\"v1.0.0\",\"toTag\":\"v1.1.0\",\"project\":\"afct\",\"requestId\":\"rec3\",\"images\":{\"app\":\"sha256:img-v1.0.0\"},\"envChanged\":true,\"composeReplaced\":true,\"composeBackup\":\"$TESTDIR/docker-compose.yml.bak.rec3\",\"committed\":false}"
  export MOCK_DEPLOYED_TAG=v1.0.0
  export MOCK_HEALTH=healthy
  run sh updater.sh
  [ "$(phase)" = "rolled_back" ]
  [ "$(tag_now)" = "v1.0.0" ]
  # The compose file was reverted to the pre-upgrade one (no worker service).
  run grep -q 'worker:' docker-compose.yml; [ "$status" -ne 0 ]
}

@test "rollback uses local images and never pulls from the registry" {
  export MOCK_PULL_RC=1                     # registry pull unavailable
  export MOCK_ARGS_LOG="$TESTDIR/args.log"
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"reg1","backupFirst":false}'
  run sh updater.sh
  # The forward pull failed, but rollback recreated from local images and succeeded.
  [ "$(phase)" = "rolled_back" ]
  [ "$(tag_now)" = "v1.0.0" ]
  # Exactly one `compose pull` was attempted (the forward one); rollback did NOT pull.
  run sh -c "grep -c ' pull ' \"$MOCK_ARGS_LOG\""
  [ "$output" -eq 1 ]
}

@test "rollback retags the previous image from the local cache when its tag was removed" {
  export MOCK_PULL_RC=1                      # forward pull fails -> rollback
  export MOCK_DEPLOYED_TAG=v1.0.0
  export MOCK_MISSING_TAGS="v1.0.0"          # the previous tag is gone locally
  export MOCK_HEALTH=healthy
  export MOCK_ARGS_LOG="$TESTDIR/args.log"
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"retag1","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "rolled_back" ]
  [ "$(tag_now)" = "v1.0.0" ]
  # It re-pointed the previous tag at the captured local image id before recreating.
  run grep -Eq '^tag +sha256:img-v1.0.0' "$MOCK_ARGS_LOG"; [ "$status" -eq 0 ]
}

@test "an unreadable transaction file is discarded and a queued request still runs" {
  txn '{ this is not valid json'
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"badtxn","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  [ "$(tag_now)" = "v1.1.0" ]
  [ ! -f "$TESTDIR/triggers/transaction.json" ]
}

@test "an unfinished transaction is resolved before a newer queued request is processed" {
  printf 'NODE_ENV=production\nAFCT_APP_TAG=v1.1.0\nNEXTAUTH_SECRET=keepme\n' > .env.production
  txn '{"schema":"afct-update-txn/v1","action":"upgrade","phase":"recreating","fromTag":"v1.0.0","toTag":"v1.1.0","project":"afct","requestId":"old","images":{"app":"sha256:img-v1.0.0"},"envChanged":true,"composeReplaced":false,"composeBackup":"","committed":false}'
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"new","backupFirst":false}'
  export MOCK_DEPLOYED_TAG=v1.0.0
  export MOCK_HEALTH=healthy
  run sh updater.sh
  # Recovery ran first (its log line survives even though the later upgrade resets the
  # progress file), then the queued request re-applied v1.1.0 cleanly.
  [[ "$output" == *"recovering an interrupted upgrade"* ]]
  [ "$(tag_now)" = "v1.1.0" ]
  [ "$(phase)" = "healthy" ]
}

@test "a claimed request with no transaction is re-queued and processed after a restart" {
  # Crash before a transaction was opened: only the claim exists, nothing changed yet.
  printf '%s' '{"action":"upgrade","tag":"v1.1.0","requestId":"claim1","backupFirst":false}' > triggers/.processing.json
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  [ "$(tag_now)" = "v1.1.0" ]
}

@test "a stale claim is superseded by a newer queued request" {
  printf '%s' '{"action":"upgrade","tag":"v9.9.9","requestId":"stale","backupFirst":false}' > triggers/.processing.json
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"fresh","backupFirst":false}'
  run sh updater.sh
  # The fresh request wins; the stale claim (to a bogus tag) is discarded, never run.
  [ "$(phase)" = "healthy" ]
  [ "$(tag_now)" = "v1.1.0" ]
}

@test "recovery of an interrupted downgrade is surfaced for manual recovery" {
  printf 'NODE_ENV=production\nAFCT_APP_TAG=v0.9.0\nNEXTAUTH_SECRET=keepme\n' > .env.production
  txn '{"schema":"afct-update-txn/v1","action":"downgrade","phase":"restoring","fromTag":"v1.0.0","toTag":"v0.9.0","project":"afct","requestId":"dgr1","images":{},"envChanged":true,"composeReplaced":false,"composeBackup":"","committed":false}'
  export MOCK_HEALTH=healthy
  run sh updater.sh
  [ "$(phase)" = "failed" ]
  [[ "$(jq -r '.message' triggers/status.json)" == *"manual recovery"* ]]
  [ ! -f "$TESTDIR/triggers/transaction.json" ]
}

# --- Stage 2: stack-wide health, stability window, retries, self-update handshake ------ #

@test "a service with no healthcheck passes on running by default" {
  export MOCK_HEALTH=none
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"h1","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  [ "$(tag_now)" = "v1.1.0" ]
}

@test "with REQUIRE_HEALTHCHECKS a service missing a healthcheck fails verification and rolls back" {
  export MOCK_HEALTH=none
  export UPDATER_REQUIRE_HEALTHCHECKS=true
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"h2","backupFirst":false}'
  run sh updater.sh
  [ "$(tag_now)" = "v1.0.0" ]
  [[ "$(phase)" == "rolled_back" || "$(phase)" == "failed" ]]
}

@test "a crashed container fails the upgrade fast and rolls back" {
  export MOCK_STATE=exited
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"h3","backupFirst":false}'
  run sh updater.sh
  [ "$(tag_now)" = "v1.0.0" ]
  [[ "$(phase)" == "rolled_back" || "$(phase)" == "failed" ]]
}

@test "an upgrade that stays healthy through the stability window commits" {
  export UPDATER_STABILITY_SECONDS=2
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"s1","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  [ "$(tag_now)" = "v1.1.0" ]
  run grep -q 'stack stable' "$TESTDIR/triggers/progress.log"; [ "$status" -eq 0 ]
}

@test "an upgrade that degrades during the stability window is rolled back" {
  # Healthy through the initial stack verify (four service inspects), then unhealthy, so
  # the stability watch catches the degradation and rolls back.
  export UPDATER_STABILITY_SECONDS=4
  export MOCK_UNHEALTHY_AFTER=4
  export MOCK_HEALTH_COUNT_FILE="$TESTDIR/hc-stab"
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"s2","backupFirst":false}'
  run sh updater.sh
  [ "$(tag_now)" = "v1.0.0" ]
  [[ "$(phase)" == "rolled_back" || "$(phase)" == "failed" ]]
  run grep -q 'degraded during the stability window' "$TESTDIR/triggers/progress.log"; [ "$status" -eq 0 ]
}

@test "a degraded service is named, not just reported as one of several" {
  # The reason this exists: v0.9.4 rolled back three times saying only that "a service
  # degraded", and the rollback then destroyed the container holding the explanation, so
  # naming the service needed a deliberate reproduction on the production box.
  export UPDATER_STABILITY_SECONDS=4
  export MOCK_UNHEALTHY_AFTER=4
  export MOCK_HEALTH_COUNT_FILE="$TESTDIR/hc-named"
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"s2n","backupFirst":false}'
  run sh updater.sh
  [ "$(tag_now)" = "v1.0.0" ]
  # The service name and the state that damned it both appear on the line.
  run grep -qE 'degraded during the stability window:.*(app|worker|nginx|db-backup)=' \
    "$TESTDIR/triggers/progress.log"
  [ "$status" -eq 0 ]
  run grep -q 'unhealthy' "$TESTDIR/triggers/progress.log"; [ "$status" -eq 0 ]
}

@test "a degraded service's output is copied out before the rollback destroys it" {
  export UPDATER_STABILITY_SECONDS=4
  export MOCK_UNHEALTHY_AFTER=4
  export MOCK_HEALTH_COUNT_FILE="$TESTDIR/hc-logs"
  export MOCK_LOGS="Error: Cannot find module 'chalk'\nRequire stack:\n- /app/src/lib/prisma.ts\n"
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"s2l","backupFirst":false}'
  run sh updater.sh
  [ "$(tag_now)" = "v1.0.0" ]
  run grep -q 'last output from' "$TESTDIR/triggers/progress.log"; [ "$status" -eq 0 ]
  # The actual failure text survives the rollback, which is the whole point.
  run grep -q "Cannot find module 'chalk'" "$TESTDIR/triggers/progress.log"
  [ "$status" -eq 0 ]
}

@test "a transient image-pull failure is retried and then succeeds" {
  export MOCK_PULL_FAIL_TIMES=2
  export MOCK_PULL_COUNT_FILE="$TESTDIR/pc"
  export UPDATER_PULL_RETRIES=3
  export UPDATER_PULL_RETRY_DELAY=0
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"pr1","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  [ "$(tag_now)" = "v1.1.0" ]
  run grep -q 'retrying' "$TESTDIR/triggers/progress.log"; [ "$status" -eq 0 ]
}

@test "exhausted image-pull retries roll back" {
  export MOCK_PULL_RC=1
  export UPDATER_PULL_RETRIES=2
  export UPDATER_PULL_RETRY_DELAY=0
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"pr2","backupFirst":false}'
  run sh updater.sh
  [ "$(tag_now)" = "v1.0.0" ]
  [[ "$(phase)" == "rolled_back" || "$(phase)" == "failed" ]]
  run grep -q 'image pull failed after' "$TESTDIR/triggers/progress.log"; [ "$status" -eq 0 ]
}

@test "a transient release-compose fetch failure is retried and then applied" {
  export UPDATER_COMPOSE_BASE_URL="https://raw.githubusercontent.com/PennStateCS/AFCT"
  export MOCK_COMPOSE_BODY='services:\n  app: {}\n  worker: {}\n'
  export MOCK_CURL_FAIL_TIMES=1
  export MOCK_CURL_COUNT_FILE="$TESTDIR/cc"
  export UPDATER_FETCH_RETRIES=3
  export UPDATER_FETCH_RETRY_DELAY=0
  printf 'services: {}\n' > docker-compose.yml
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"fr1","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  run grep -q 'worker:' docker-compose.yml; [ "$status" -eq 0 ]
  # The fetch was attempted twice: it failed once, was retried, then succeeded, and the
  # retry is logged to the streamed progress log.
  [ "$(cat "$TESTDIR/cc")" -ge 2 ]
  run grep -q 'network fetch failed' "$TESTDIR/triggers/progress.log"; [ "$status" -eq 0 ]
}

# self-update confirmation handshake
supending() { printf '%s' "$1" > "$TESTDIR/triggers/.self-update-pending.json"; }

@test "self-update stays in-flight until the replacement updater confirms the version" {
  supending '{"tag":"v1.1.0","requestId":"su2","fromTag":"v1.0.0"}'
  export MOCK_SELF_IMAGE_TAG=v1.1.0
  run sh updater.sh
  [ "$status" -eq 0 ]
  [ "$(phase)" = "healthy" ]
  [[ "$(jq -r '.message' triggers/status.json)" == *"update service updated to v1.1.0"* ]]
  [ ! -f "$TESTDIR/triggers/.self-update-pending.json" ]
}

@test "self-update reports failure when the replacement came back on the wrong version" {
  supending '{"tag":"v1.1.0","requestId":"su3","fromTag":"v1.0.0"}'
  export MOCK_SELF_IMAGE_TAG=v0.9.0
  run sh updater.sh
  [ "$(phase)" = "failed" ]
  [[ "$(jq -r '.message' triggers/status.json)" == *"did not come back on v1.1.0"* ]]
  [ ! -f "$TESTDIR/triggers/.self-update-pending.json" ]
}

# --- Stage 3: fail-closed manifest, compose checksum, downgrade backup, file hardening -- #

@test "an unlisted tag is refused when no manifest can be consulted (fail closed)" {
  # No remote manifest URL, no local versions.json, and the override off: the character
  # allowlist alone must not be enough to allow a tag.
  export UPDATER_ALLOW_UNVERIFIED_TAGS=false
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"fc1","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "failed" ]
  [[ "$(jq -r '.message' triggers/status.json)" == *"not an allowed release"* ]]
  [ "$(tag_now)" = "v1.0.0" ]
}

@test "an offline deployment can allow unverified tags with the override" {
  # Same conditions, but the explicit opt-in restores the permissive behaviour.
  export UPDATER_ALLOW_UNVERIFIED_TAGS=true
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"fc2","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  [ "$(tag_now)" = "v1.1.0" ]
}

@test "a release compose that matches its manifest checksum is applied" {
  export UPDATER_COMPOSE_BASE_URL="https://raw.githubusercontent.com/PennStateCS/AFCT"
  _body='services: {app: {}, worker: {}}'
  export MOCK_COMPOSE_BODY="$_body"
  printf 'services: {}\n' > docker-compose.yml
  _sha=$(printf '%s' "$_body" | sha256sum | awk '{print $1}')
  printf '{"versions":[{"tag":"v1.1.0","composeSha256":"%s"}]}\n' "$_sha" > versions.json
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"cs1","backupFirst":false}'
  run sh updater.sh
  [ "$(phase)" = "healthy" ]
  # The checksum matched, so the release compose was swapped in.
  run grep -q 'worker:' docker-compose.yml; [ "$status" -eq 0 ]
}

@test "a release compose that fails its manifest checksum is rejected" {
  export UPDATER_COMPOSE_BASE_URL="https://raw.githubusercontent.com/PennStateCS/AFCT"
  export MOCK_COMPOSE_BODY='services: {app: {}, worker: {}}'
  printf 'services: {}\n' > docker-compose.yml
  # A checksum the fetched file will not match.
  printf '{"versions":[{"tag":"v1.1.0","composeSha256":"0000000000000000000000000000000000000000000000000000000000000000"}]}\n' > versions.json
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"cs2","backupFirst":false}'
  run sh updater.sh
  # The upgrade still proceeds (best-effort compose), but on the CURRENT stack config: the
  # mismatched release compose was not installed.
  [ "$(phase)" = "healthy" ]
  run grep -q 'worker:' docker-compose.yml; [ "$status" -ne 0 ]
  run grep -q 'checksum' "$TESTDIR/triggers/progress.log"; [ "$status" -eq 0 ]
}

@test "a downgrade is refused when the safety backup cannot be confirmed" {
  printf '[{"version":"v0.9.0","backup":"20260101-000000","createdAt":"x"}]\n' > triggers/restore-points.json
  : > backups/afct-20260101-000000.dump
  export UPDATER_BACKUP_TIMEOUT=2   # no backup sidecar served, so the snapshot times out
  request '{"action":"downgrade","tag":"v0.9.0","requestId":"nf1","restorePoint":"20260101-000000"}'
  run sh updater.sh
  [ "$(phase)" = "failed" ]
  [[ "$(jq -r '.message' triggers/status.json)" == *"Could not confirm a backup"* ]]
  # It refused before touching anything: the app was never stopped or restored.
  [ "$(tag_now)" = "v1.0.0" ]
  [ ! -f backup-triggers/restore-now ]
}

@test "a forced downgrade proceeds even without a confirmed safety backup" {
  printf '[{"version":"v0.9.0","backup":"20260101-000000","createdAt":"x"}]\n' > triggers/restore-points.json
  : > backups/afct-20260101-000000.dump
  export UPDATER_BACKUP_TIMEOUT=2 UPDATER_RESTORE_TIMEOUT=20
  request '{"action":"downgrade","tag":"v0.9.0","requestId":"nf2","restorePoint":"20260101-000000","force":true}'
  serve_restore "ok 20260101-000000"; watcher=$!
  run sh updater.sh
  kill "$watcher" 2>/dev/null || true
  [ "$(phase)" = "healthy" ]
  [ "$(tag_now)" = "v0.9.0" ]
  run grep -q 'forced' "$TESTDIR/triggers/progress.log"; [ "$status" -eq 0 ]
}

@test "a symlinked request file is refused and never followed" {
  ln -s "$TESTDIR/.env.production" triggers/request.json
  run sh updater.sh
  [ "$status" -eq 0 ]
  # The link is deleted, not followed; no request is claimed from it.
  [ ! -L triggers/request.json ]
  [ ! -f triggers/.processing.json ]
  [ "$(tag_now)" = "v1.0.0" ]
}

@test "an oversized request file is refused before it is parsed" {
  export UPDATER_REQUEST_MAX_BYTES=100
  { printf '{"action":"upgrade","tag":"v1.1.0","requestId":"big","pad":"'
    _i=0; while [ "$_i" -lt 300 ]; do printf 'x'; _i=$((_i + 1)); done
    printf '"}\n'; } > triggers/request.json
  run sh updater.sh
  [ "$status" -eq 0 ]
  # Rejected and removed before jq saw it; nothing was claimed and the version is untouched.
  [ ! -f triggers/request.json ]
  [ ! -f triggers/.processing.json ]
  [ "$(tag_now)" = "v1.0.0" ]
}


@test "a missing env file names the path instead of failing opaquely" {
  # The failure that made an upgrade unexplainable in production: the updater kept the
  # env path it was created with after the file moved, so every upgrade failed here.
  rm -f "$TESTDIR/.env.production"
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"noenv","backupFirst":false}'
  run sh updater.sh
  [ "$status" -eq 0 ]
  [ "$(phase)" = "failed" ]
  jq -r '.message' triggers/status.json | grep -q "$TESTDIR/.env.production"
  jq -r '.message' triggers/status.json | grep -qi 'UPDATER_ENV_FILE'
}

@test "a failed tag rewrite leaves no temp file behind" {
  rm -f "$TESTDIR/.env.production"
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"notmp","backupFirst":false}'
  run sh updater.sh
  [ "$status" -eq 0 ]
  # Root-owned empty .updtmp.* files used to accumulate, one per attempt.
  [ -z "$(ls "$TESTDIR"/.env.production.updtmp.* 2>/dev/null)" ]
}

@test "readiness reports the resolved paths and that they exist" {
  run sh updater.sh
  [ "$status" -eq 0 ]
  [ -f triggers/updater.readiness.json ]
  [ "$(jq -r '.envFileOk' triggers/updater.readiness.json)" = "true" ]
  [ "$(jq -r '.composeFileOk' triggers/updater.readiness.json)" = "true" ]
  [ "$(jq -r '.envFile' triggers/updater.readiness.json)" = "$TESTDIR/.env.production" ]
}

@test "readiness reports a missing env file, which is how the UI can warn first" {
  rm -f "$TESTDIR/.env.production"
  run sh updater.sh
  [ "$status" -eq 0 ]
  [ "$(jq -r '.envFileOk' triggers/updater.readiness.json)" = "false" ]
  [ "$(jq -r '.composeFileOk' triggers/updater.readiness.json)" = "true" ]
}

# An in-app upgrade never runs the host installer, so the key top-up has to live here as well.
# From the release that added it, the backup service refuses to write an archive without a key
# rather than writing one in the clear; an upgrade that did not top it up would stop backups
# silently, which is the worst shape a backup failure can take.
# The key AFCT encrypts stored settings with. An install predating it comes up healthy and then
# refuses the first thing an administrator saves, which is how a real deployment found out.
@test "an upgrade generates a secret-encryption key when there is none" {
  run grep -q 'AFCT_SECRET_KEY' "$TESTDIR/.env.production"; [ "$status" -ne 0 ]

  request '{"action":"upgrade","tag":"v1.1.0","requestId":"skey","backupFirst":false}'
  run sh updater.sh
  [ "$status" -eq 0 ]

  run grep -Eq '^AFCT_SECRET_KEY=.{32,}$' "$TESTDIR/.env.production"; [ "$status" -eq 0 ]
  # Everything else in the file survives the rewrite.
  run grep -q '^NEXTAUTH_SECRET=keepme$' "$TESTDIR/.env.production"; [ "$status" -eq 0 ]
}

# Replacing one makes every secret already stored with it unreadable, which is the single
# unrecoverable mistake available on this path.
@test "an upgrade never replaces an existing secret-encryption key" {
  printf 'AFCT_SECRET_KEY=originalsecretkeyvaluethatmustsurvive\n' >> "$TESTDIR/.env.production"

  request '{"action":"upgrade","tag":"v1.1.0","requestId":"skey2","backupFirst":false}'
  run sh updater.sh
  [ "$status" -eq 0 ]

  run grep -q '^AFCT_SECRET_KEY=originalsecretkeyvaluethatmustsurvive$' "$TESTDIR/.env.production"
  [ "$status" -eq 0 ]
}

@test "an upgrade generates a backup-encryption key when there is none" {
  run grep -q 'BACKUP_ENCRYPTION_KEY' "$TESTDIR/.env.production"; [ "$status" -ne 0 ]

  request '{"action":"upgrade","tag":"v1.1.0","requestId":"bkey","backupFirst":false}'
  run sh updater.sh
  [ "$status" -eq 0 ]

  run grep -Eq '^BACKUP_ENCRYPTION_KEY=.{32,}$' "$TESTDIR/.env.production"; [ "$status" -eq 0 ]
  # Everything else in the file survives the rewrite.
  run grep -q '^NEXTAUTH_SECRET=keepme$' "$TESTDIR/.env.production"; [ "$status" -eq 0 ]
}

# Replacing one strands every archive already written with it, which is worse than any upgrade
# problem it could solve.
@test "an upgrade never replaces an existing backup-encryption key" {
  printf 'BACKUP_ENCRYPTION_KEY=keepthisexactbackupkeykeepthisexact\n' >> "$TESTDIR/.env.production"

  request '{"action":"upgrade","tag":"v1.1.0","requestId":"bkeep","backupFirst":false}'
  run sh updater.sh
  [ "$status" -eq 0 ]

  run grep -q '^BACKUP_ENCRYPTION_KEY=keepthisexactbackupkeykeepthisexact$' "$TESTDIR/.env.production"
  [ "$status" -eq 0 ]
  [ "$(grep -c '^BACKUP_ENCRYPTION_KEY=' "$TESTDIR/.env.production")" -eq 1 ]
}

# Somebody who chose plaintext archives must not have a key appear behind them on upgrade.
@test "an upgrade respects an explicit opt-out" {
  printf 'BACKUP_ALLOW_UNENCRYPTED=true\n' >> "$TESTDIR/.env.production"

  request '{"action":"upgrade","tag":"v1.1.0","requestId":"bopt","backupFirst":false}'
  run sh updater.sh
  [ "$status" -eq 0 ]

  run grep -q 'BACKUP_ENCRYPTION_KEY' "$TESTDIR/.env.production"
  [ "$status" -ne 0 ]
}

# --------------------------------------------------------------------------- #
# Host facts
#
# What the updater can see of the machine it runs on, written for Admin -> System
# Status. The rule throughout: absence is reported as "cannot tell", never as an
# all-clear, because an operator acting on a false all-clear is the failure here.
# --------------------------------------------------------------------------- #

# Build a fake host tree and point the updater at it.
host_root() {
  mkdir -p "$TESTDIR/host/run" "$TESTDIR/host/etc" "$TESTDIR/host/var/lib/update-notifier"
  export UPDATER_HOST_ROOT="$TESTDIR/host"
}

ubuntu_host() {
  host_root
  printf 'ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n' > "$TESTDIR/host/etc/os-release"
}

facts() { jq -r "$1" "$TESTDIR/triggers/host.json"; }

@test "host facts report a recognised server" {
  ubuntu_host
  run sh updater.sh
  [ "$status" -eq 0 ]
  [ "$(facts .supported)" = "true" ]
  [ "$(facts .osName)" = "Ubuntu 24.04.1 LTS" ]
  [ "$(facts .rebootRequired)" = "false" ]
}

@test "host facts see a pending restart and the packages behind it" {
  ubuntu_host
  : > "$TESTDIR/host/run/reboot-required"
  printf 'linux-image-generic\nlibc6\nlibc6\n' > "$TESTDIR/host/run/reboot-required.pkgs"

  run sh updater.sh
  [ "$(facts .rebootRequired)" = "true" ]
  # De-duplicated, because apt lists a package once per trigger.
  [ "$(facts '.rebootPackages | length')" -eq 2 ]
  run jq -e '.rebootPackages | index("libc6")' "$TESTDIR/triggers/host.json"; [ "$status" -eq 0 ]
}

@test "host facts count waiting updates from the notice the host writes" {
  ubuntu_host
  cat > "$TESTDIR/host/var/lib/update-notifier/updates-available" <<'EOF'

28 updates can be applied immediately.
5 of these updates are standard security updates.

EOF

  run sh updater.sh
  [ "$(facts .updatesAvailable)" -eq 28 ]
  [ "$(facts .securityUpdatesAvailable)" -eq 5 ]
}

# Zero waiting updates and "AFCT could not find out" are different answers, and the
# screen prints them differently.
@test "host facts report unknown counts as null, not zero" {
  ubuntu_host
  run sh updater.sh
  [ "$(facts .updatesAvailable)" = "null" ]
  [ "$(facts .securityUpdatesAvailable)" = "null" ]
}

@test "host facts report a clock only when the host says whether it is in sync" {
  ubuntu_host
  run sh updater.sh
  # No timesyncd on this host: unknown, not wrong.
  [ "$(facts .timeSynchronised)" = "null" ]

  mkdir -p "$TESTDIR/host/run/systemd/timesync"
  run sh updater.sh
  [ "$(facts .timeSynchronised)" = "false" ]

  : > "$TESTDIR/host/run/systemd/timesync/synchronized"
  run sh updater.sh
  [ "$(facts .timeSynchronised)" = "true" ]
}

# A Windows install mounts Docker's own Linux VM here, and any other distribution is a
# host whose conventions these checks do not describe. Both must come back unsupported.
@test "host facts refuse to guess about an unrecognised host" {
  host_root
  printf 'ID=alpine\nPRETTY_NAME="Docker Desktop"\n' > "$TESTDIR/host/etc/os-release"
  : > "$TESTDIR/host/run/reboot-required"

  run sh updater.sh
  [ "$(facts .supported)" = "false" ]
  # And it does not pass on what it saw in there.
  [ "$(facts .rebootRequired)" = "false" ]
}

@test "host facts are written even with no host mounts at all" {
  export UPDATER_HOST_ROOT="$TESTDIR/nowhere"
  run sh updater.sh
  [ "$status" -eq 0 ]
  [ -s "$TESTDIR/triggers/host.json" ]
  [ "$(facts .supported)" = "false" ]
  [ -n "$(facts .checkedAt)" ]
}

# --- env-file writes: appends must not land inside the previous line ------------------- #

@test "an env file with no trailing newline comes through an upgrade intact" {
  # An env file edited by hand on the host can easily lack a final newline. This is the
  # end-to-end property: nothing is corrupted and every key the upgrade adds is findable.
  # Note what actually saves it here is the tag rewrite, whose awk branch re-emits every
  # line newline-terminated; the append path is covered by the test below, which is the
  # one that fails without the guard.
  printf 'AFCT_APP_TAG=v1.0.0\nNEXTAUTH_SECRET=keepme' > .env.production   # no trailing newline
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"nl1","backupFirst":false}'
  run sh updater.sh

  # The pre-existing secret survives intact, on its own line.
  run grep -qx 'NEXTAUTH_SECRET=keepme' .env.production; [ "$status" -eq 0 ]
  # And the keys the upgrade appends are findable, which is what silently failed before.
  run grep -qE '^AFCT_SECRET_KEY=.' .env.production; [ "$status" -eq 0 ]
  [ "$(tag_now)" = "v1.1.0" ]
}

@test "the tag is appended on its own line when the env file has no trailing newline" {
  # The reachable corruption: no AFCT_APP_TAG line to rewrite, so the tag is appended with
  # cat, and without the guard it lands inside the preceding line. If that line is a
  # password the stack stops starting, and a rollback does not repair it, because rollback
  # only rewrites the tag line it can no longer find.
  printf 'NODE_ENV=production\nNEXTAUTH_SECRET=keepme' > .env.production
  request '{"action":"upgrade","tag":"v1.1.0","requestId":"nl2","backupFirst":false}'
  run sh updater.sh

  run grep -qx 'NEXTAUTH_SECRET=keepme' .env.production; [ "$status" -eq 0 ]
  run grep -qx 'AFCT_APP_TAG=v1.1.0' .env.production; [ "$status" -eq 0 ]
}
