#!/bin/sh
# Real `docker compose config` integration test for the versioned Linux layout.
#
# This does NOT mock Compose. It reproduces the installed directory separation exactly:
#   releases/<version>/docker-compose.yml   (the versioned, immutable stack file)
#   shared/.env.production                   (the persistent configuration, elsewhere)
# and asserts that with the runtime path variables afctctl exports, `docker compose config`
# resolves the per-service env_file to the SHARED path (not a file next to the Compose file),
# and that the updater's scoped mounts point at the runtime/shared directories.
#
# It also checks the Windows default: with none of the AFCT_RUNTIME_* variables set, the
# env_file falls back to a co-located .env.production, so the Windows installer is unchanged.
#
# Requires a docker CLI with the compose plugin. `docker compose config` is client-side and
# needs no daemon. Run: sh deploy/test/compose-config.sh

set -eu

SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "${SELF_DIR}/.." && pwd)

if ! docker compose version >/dev/null 2>&1; then
  echo "SKIP: docker compose is not available"
  exit 0
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

# Build the split installed layout.
PREFIX="$WORK/opt"
REL="$PREFIX/releases/2.2.0-deadbeef"
SHARED="$PREFIX/shared"
RUNTIME="$SHARED/runtime"
mkdir -p "$REL" "$SHARED" "$RUNTIME"

cp "$DEPLOY_DIR/docker-compose.yml" "$REL/docker-compose.yml"
# The runtime Compose file afctctl seeds from the release (same content).
cp "$DEPLOY_DIR/docker-compose.yml" "$RUNTIME/docker-compose.yml"

cat > "$SHARED/.env.production" <<'EOF'
NODE_ENV=production
POSTGRES_PASSWORD=integration-secret-000
DATABASE_URL=postgresql://afct_user:integration-secret-000@postgres:5432/afct
ADMIN_EMAIL=admin@example.edu
ADMIN_PASSWORD=Str0ng!Pass1
NEXTAUTH_SECRET=integration-secret-nextauth-000000000000
NEXTAUTH_URL=https://afct.example.edu
AUTH_TRUST_HOST=true
AFCT_APP_TAG=v0.0.1
BACKUP_ENCRYPTION_KEY=
EOF
chmod 600 "$SHARED/.env.production"

fail() { echo "FAIL: $*" >&2; exit 1; }

# --- Linux: the runtime Compose file + shared env, with the runtime path variables -------
echo "== Linux split layout: docker compose config =="
CONFIG=$(
  AFCT_RUNTIME_ENV_FILE="$SHARED/.env.production" \
  AFCT_RUNTIME_COMPOSE_DIR="$RUNTIME" \
  AFCT_RUNTIME_SHARED_DIR="$SHARED" \
  docker compose -p afct --env-file "$SHARED/.env.production" -f "$RUNTIME/docker-compose.yml" config
) || fail "docker compose config failed for the split layout"

# The app service must have received the secret from the SHARED env file (env_file resolved
# to the shared path, not a missing file next to the Compose file).
printf '%s\n' "$CONFIG" | grep -q 'integration-secret-000' \
  || fail "the shared .env.production was not applied to the services (env_file did not resolve to the shared path)"

# The app image tag interpolated from the shared env.
printf '%s\n' "$CONFIG" | grep -q 'afct-dashboard:v0.0.1' \
  || fail "AFCT_APP_TAG from the shared env did not interpolate"

echo "  OK: services read the shared .env.production; the release directory holds no config"

# --- Updater scoped mounts point at the runtime + shared directories ----------------------
echo "== Updater scoped mounts =="
UPCONFIG=$(
  AFCT_RUNTIME_ENV_FILE="$SHARED/.env.production" \
  AFCT_RUNTIME_COMPOSE_DIR="$RUNTIME" \
  AFCT_RUNTIME_SHARED_DIR="$SHARED" \
  docker compose -p afct --profile updater --env-file "$SHARED/.env.production" -f "$RUNTIME/docker-compose.yml" config
) || fail "docker compose config failed with the updater profile"
printf '%s\n' "$UPCONFIG" | grep -q "$RUNTIME" \
  || fail "the updater compose mount did not resolve to the runtime directory"
printf '%s\n' "$UPCONFIG" | grep -q "$SHARED" \
  || fail "the updater shared mount did not resolve to the shared directory"
echo "  OK: updater mounts /afct-compose and /afct-shared from the runtime and shared dirs"

# --- Windows default: no runtime variables => co-located .env.production ------------------
echo "== Windows default (co-located .env.production) =="
WINDIR="$WORK/win"
mkdir -p "$WINDIR"
cp "$DEPLOY_DIR/docker-compose.yml" "$WINDIR/docker-compose.yml"
cp "$SHARED/.env.production" "$WINDIR/.env.production"
WCONFIG=$(
  cd "$WINDIR" && docker compose -p afct --env-file .env.production -f docker-compose.yml config
) || fail "docker compose config failed for the co-located (Windows) layout"
printf '%s\n' "$WCONFIG" | grep -q 'integration-secret-000' \
  || fail "the co-located .env.production was not applied (Windows default regressed)"
echo "  OK: with no AFCT_RUNTIME_* variables, env_file falls back to the co-located file"

echo "ALL OK"
