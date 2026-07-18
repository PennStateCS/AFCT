#!/bin/sh
# Prepares the environment before the app starts: verify config, wait for the
# database, run migrations, optionally seed, then hand off to the given command.
set -e

log() { echo "[afct] $*"; }

log "starting (NODE_ENV=${NODE_ENV:-unset})"

# Writable dirs the app expects (dev mounts these as volumes).
mkdir -p /app/.next /app/node_modules || true
mkdir -p /private/uploads/pfps /private/uploads/problems \
         /private/uploads/solutions /private/uploads/submissions || true

# When running as root (dev), hand the mounted paths to the node user.
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/.next /app/node_modules /private/uploads || true
fi

# --- Dependencies (dev only) ---
# node_modules is a named volume that outlives image rebuilds (same reason the
# Prisma client is regenerated below). So a dependency change in the bind-mounted
# package-lock.json can leave the volume stale, and a manual `npm ci` into a running
# container can be interrupted by the restart policy and leave it half-installed --
# either of which crash-loops the app. Reconcile it here instead: if the marker is
# missing or differs from the current lockfile, run a clean install before anything
# else touches node_modules. This runs synchronously in the entrypoint (no running
# dev server to kill), so it can't be interrupted mid-install. In prod node_modules
# is baked into the image, not a volume, so this never runs.
DEPS_MARKER="node_modules/.afct-deps-lock"
if [ "${ENSURE_DEPS:-true}" = "true" ] && [ "${NODE_ENV:-}" = "development" ]; then
  if [ ! -f package-lock.json ]; then
    log "no package-lock.json; skipping dependency sync"
  elif [ ! -f "$DEPS_MARKER" ] || ! cmp -s package-lock.json "$DEPS_MARKER"; then
    log "dependencies changed; installing (npm ci, this can take a minute)"
    SKIP_PRISMA_GENERATE=1 npm ci --legacy-peer-deps --no-audit --progress=false
    cp package-lock.json "$DEPS_MARKER"
    log "dependencies installed"
  else
    log "dependencies up to date"
  fi
fi

# The app can't run without a database.
if [ -z "${DATABASE_URL:-}" ]; then
  log "DATABASE_URL is not set; refusing to start"
  exit 1
fi

# --- Wait for the database ---
WAIT_FOR_DB="${WAIT_FOR_DB:-true}"
DB_WAIT_SECONDS="${DB_WAIT_SECONDS:-60}"
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-afct_user}"
DB_NAME="${DB_NAME:-afct}"

if [ "$WAIT_FOR_DB" = "true" ]; then
  log "waiting for database ${DB_HOST}:${DB_PORT} (timeout ${DB_WAIT_SECONDS}s)"
  i=0
  # pg_isready is the real readiness check; fall back to a raw TCP probe if the
  # postgres client isn't installed.
  if command -v pg_isready >/dev/null 2>&1; then
    until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
      i=$((i + 1))
      [ "$i" -ge "$DB_WAIT_SECONDS" ] && { log "database not ready after ${DB_WAIT_SECONDS}s"; exit 1; }
      sleep 1
    done
  elif command -v nc >/dev/null 2>&1; then
    until nc -z "$DB_HOST" "$DB_PORT" >/dev/null 2>&1; do
      i=$((i + 1))
      [ "$i" -ge "$DB_WAIT_SECONDS" ] && { log "database not ready after ${DB_WAIT_SECONDS}s"; exit 1; }
      sleep 1
    done
  else
    log "no pg_isready or nc available to probe the database"
    exit 1
  fi
  log "database is reachable"
else
  log "WAIT_FOR_DB=false; skipping database wait"
fi

# --- Prisma client ---
# The client is baked into the image. In dev, node_modules is a named volume that
# outlives image rebuilds, so a schema change (e.g. adding a column) leaves a stale
# client that no longer matches the schema/DB — and the app then crashes with
# "Unknown field ... for select statement". Regenerate every start in dev to keep the
# volume's client in sync with the bind-mounted schema. In prod the baked client is
# authoritative and node_modules isn't a mounted volume, so only generate if missing.
if [ "${ENSURE_PRISMA_CLIENT:-true}" = "true" ]; then
  if [ "${NODE_ENV:-}" = "development" ]; then
    log "regenerating Prisma client (dev; schema may have changed)"
    npx prisma generate || true
  elif [ ! -d node_modules/@prisma/client ] || [ ! -f node_modules/.prisma/client/index.js ]; then
    log "Prisma client missing; generating"
    npx prisma generate || true
  fi
fi

# --- Migrations ---
if [ "${MIGRATE_ON_START:-true}" = "true" ]; then
  log "applying migrations"
  npx prisma migrate deploy
else
  log "MIGRATE_ON_START=false; skipping migrations"
fi

# --- Seed ---
# `auto` seeds only in production (the prod seed just bootstraps an admin if the
# database is empty); `true` always seeds; anything else never does.
SEED_ON_START="${SEED_ON_START:-auto}"
should_seed=false
if [ "$SEED_ON_START" = "true" ]; then
  should_seed=true
elif [ "$SEED_ON_START" = "auto" ] && [ "${NODE_ENV:-}" = "production" ]; then
  should_seed=true
fi

if [ "$should_seed" = "true" ]; then
  log "seeding database"
  npx prisma db seed
else
  log "SEED_ON_START=${SEED_ON_START}; skipping seed"
fi

# Replace this shell with the app process so it receives signals directly.
log "starting app: $*"
exec "$@"
