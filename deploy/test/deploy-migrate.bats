#!/usr/bin/env bats
#
# Integration tests for legacy service-account migration and the compatibility shim's
# service-option forwarding. These create real system users and exercise ownership and
# access, so they run as root in the bats image with adduser + runuser available.
#
# Run: bats deploy/test/deploy-migrate.bats

setup() {
  DEPLOY_DIR="$BATS_TEST_DIRNAME/.."
  LINUX_DIR="$DEPLOY_DIR/linux"
  TESTROOT="$(mktemp -d)"
  DIST="$TESTROOT/dist"
  P="$TESTROOT/opt"
  # A service account must be able to traverse into the deploy tree; the mktemp root is
  # 0700, so open just the traversal bit (production /opt is world-traversable).
  chmod 0755 "$TESTROOT"
  # Deterministic paths for the shim tests, set here so they are visible in the test body
  # (a `run`-invoked helper cannot export back into the test).
  FP="$TESTROOT/shimopt"
  FB="$TESTROOT/fake-bootstrap.sh"
  ARGLOG="$TESTROOT/args.log"
  export DEPLOY_DIR LINUX_DIR TESTROOT DIST P FP FB ARGLOG
  # A real installed release the afctctl commands run from.
  TARBALL="$(sh "$LINUX_DIR/build-bundle.sh" "$DIST")"
  AFCT_PREFIX="$P" AFCT_SWITCH_ONLY=1 AFCT_BUNDLE_FILE="$TARBALL" sh "$LINUX_DIR/install.sh" >/dev/null 2>&1
  CTL="$P/current/bin/afctctl"
}

teardown() { [ -n "${TESTROOT:-}" ] && rm -rf "$TESTROOT"; }

make_legacy() {
  # $1 = marker contents ("" for none). Creates a legacy dir with a complete .env.production.
  L="$TESTROOT/legacy"; rm -rf "$L"; mkdir -p "$L"
  cat > "$L/.env.production" <<'EOF'
POSTGRES_PASSWORD=abc123abc123abc123
DATABASE_URL=postgresql://afct_user:abc123abc123abc123@postgres:5432/afct
NEXTAUTH_SECRET=secretsecretsecretsecretsecret12
NEXTAUTH_URL=https://afct.test
EOF
  [ -n "$1" ] && printf '%s\n' "$1" > "$L/.afct-service-user"
  echo "$L"
}

run_migrate() {  # extra args forwarded to migrate-legacy
  AFCT_PREFIX="$P" AFCT_LEGACY_DIR="$TESTROOT/legacy" sh "$CTL" migrate-legacy "$@"
}

# ---------------------------------------------------------------------------
# Fix 1: preserving a custom legacy service account (ownership + access)
# ---------------------------------------------------------------------------

@test "migration preserves a custom service account with ownership and access" {
  adduser -S -H -s /sbin/nologin custom-afct 2>/dev/null || true
  make_legacy custom-afct >/dev/null
  run run_migrate
  [ "$status" -eq 0 ]
  # Shared marker names the custom account.
  [ "$(cat "$P/shared/.afct-service-user")" = "custom-afct" ]
  # Shared config is owned by the custom account and private.
  [ "$(stat -c '%U' "$P/shared/.env.production")" = "custom-afct" ]
  [ "$(stat -c '%a' "$P/shared/.env.production")" = "600" ]
  # The account can traverse the tree and read the active controller, the runtime Compose
  # file, and the shared env, and can atomically rewrite the env file. runuser runs the
  # command directly, so the account's nologin shell does not matter.
  runuser -u custom-afct -- test -x "$P/current/bin/afctctl"
  runuser -u custom-afct -- test -r "$P/shared/runtime/docker-compose.yml"
  runuser -u custom-afct -- test -r "$P/shared/.env.production"
  runuser -u custom-afct -- sh -c "cd '$P/shared' && cp .env.production .env.tmp && mv .env.tmp .env.production"
  # And it can run the controller (version) through the account.
  run runuser -u custom-afct -- sh -c "AFCT_PREFIX='$P' '$P/current/bin/afctctl' version"
  [ "$status" -eq 0 ]
}

@test "a legacy marker naming a missing account falls back to current-user with no marker" {
  make_legacy ghost-afct-nope >/dev/null
  run run_migrate
  [ "$status" -eq 0 ]
  [[ "$output" == *"no longer exists"* ]]
  # No marker written for the missing account; not left in service mode.
  [ ! -f "$P/shared/.afct-service-user" ]
}

# ---------------------------------------------------------------------------
# Fix 9: migrate-legacy is idempotent
# ---------------------------------------------------------------------------

@test "migrate-legacy converges and is safe to re-run" {
  adduser -S -H -s /sbin/nologin custom-afct 2>/dev/null || true
  make_legacy custom-afct >/dev/null
  run run_migrate; [ "$status" -eq 0 ]
  _env1=$(cat "$P/shared/.env.production")
  # Re-run after a "complete" migration.
  run run_migrate; [ "$status" -eq 0 ]
  [ "$(cat "$P/shared/.afct-service-user")" = "custom-afct" ]
  [ "$(cat "$P/shared/.env.production")" = "$_env1" ]     # secrets untouched
  [ "$(stat -c '%U' "$P/shared/.env.production")" = "custom-afct" ]
}

@test "migrate-legacy re-run after a partial ownership pass repairs ownership" {
  adduser -S -H -s /sbin/nologin custom-afct 2>/dev/null || true
  make_legacy custom-afct >/dev/null
  run run_migrate; [ "$status" -eq 0 ]
  # Simulate an interrupted ownership pass: hand a shared file back to root.
  chown root "$P/shared/.env.production"
  run run_migrate; [ "$status" -eq 0 ]
  [ "$(stat -c '%U' "$P/shared/.env.production")" = "custom-afct" ]
}

# ---------------------------------------------------------------------------
# Fix 2: the compatibility shim forwards the service-account choice to migrate-legacy
# ---------------------------------------------------------------------------

# A fake bootstrap that (in switch-only mode) installs a logging afctctl, so we can see
# exactly what the shim invokes without a network download.
setup_fake_bootstrap() {
  rm -rf "$FP"; mkdir -p "$FP"
  cat > "$FB" <<'EOF'
#!/bin/sh
mkdir -p "$AFCT_PREFIX/current/bin"
cat > "$AFCT_PREFIX/current/bin/afctctl" <<'INNER'
#!/bin/sh
printf '%s\n' "$*" >> "$AFCT_ARGLOG"
INNER
chmod +x "$AFCT_PREFIX/current/bin/afctctl"
EOF
  : > "$ARGLOG"
}

run_shim() {  # args = the original user command line
  setup_fake_bootstrap
  # setup() installed a /usr/local/bin/afctctl wrapper; remove it so the shim takes the
  # not-yet-installed bootstrap path for this fresh $FP prefix instead of forwarding.
  rm -f /usr/local/bin/afctctl 2>/dev/null || true
  AFCT_PREFIX="$FP" AFCT_BOOTSTRAP_URL="file://$FB" AFCT_ARGLOG="$ARGLOG" \
    sh "$DEPLOY_DIR/install.sh" "$@"
}

@test "shim forwards --no-service-user to migrate-legacy and the final command (bare)" {
  run run_shim --no-service-user
  [ "$status" -eq 0 ]
  run grep -x 'migrate-legacy --no-service-user' "$ARGLOG"; [ "$status" -eq 0 ]
  # Bare form has no explicit command token, so the shim forwards the original argv
  # unchanged (the real afctctl maps options-without-a-command to install).
  run grep -x -- '--no-service-user' "$ARGLOG"; [ "$status" -eq 0 ]
}

@test "shim forwards --no-service-user with an explicit install command" {
  run run_shim install --no-service-user
  [ "$status" -eq 0 ]
  run grep -x 'migrate-legacy --no-service-user' "$ARGLOG"; [ "$status" -eq 0 ]
  run grep -x 'install --no-service-user' "$ARGLOG"; [ "$status" -eq 0 ]
}

@test "shim forwards --service-user NAME (space form) to migrate-legacy" {
  run run_shim install --service-user custom-afct
  [ "$status" -eq 0 ]
  run grep -x 'migrate-legacy --service-user custom-afct' "$ARGLOG"; [ "$status" -eq 0 ]
  run grep -x 'install --service-user custom-afct' "$ARGLOG"; [ "$status" -eq 0 ]
}

@test "shim forwards --service-user=NAME (equals form) to migrate-legacy" {
  run run_shim install --service-user=custom-afct
  [ "$status" -eq 0 ]
  run grep -x 'migrate-legacy --service-user custom-afct' "$ARGLOG"; [ "$status" -eq 0 ]
  run grep -x 'install --service-user=custom-afct' "$ARGLOG"; [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Fix 2 (behaviour): explicit choices at the afctctl level create the right state
# ---------------------------------------------------------------------------

@test "migrate-legacy --no-service-user creates no default account or marker" {
  make_legacy "" >/dev/null    # legacy install, no marker
  run run_migrate --no-service-user
  [ "$status" -eq 0 ]
  [ ! -f "$P/shared/.afct-service-user" ]
}

@test "migrate-legacy --service-user converts a legacy current-user install" {
  adduser -S -H -s /sbin/nologin new-afct 2>/dev/null || true
  make_legacy "" >/dev/null
  run run_migrate --service-user new-afct
  [ "$status" -eq 0 ]
  [ "$(cat "$P/shared/.afct-service-user")" = "new-afct" ]
  [ "$(stat -c '%U' "$P/shared/.env.production")" = "new-afct" ]
}
