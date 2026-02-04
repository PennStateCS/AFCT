#!/bin/sh
set -e

# --------------------------------------------
# AFCT Entrypoint
# - Validates env (DATABASE_URL required for app)
# - Waits for DB (optional)
# - Ensures Prisma client exists (optional)
# - Runs migrations (optional)
# - Seeds (optional)
# - Starts the app
# --------------------------------------------

echo "=============================================="
echo "AFCT container starting..."
echo "Node env: ${NODE_ENV:-unset}"
echo "=============================================="

# Ensure writable app dirs (for Next.js build output)
mkdir -p /app/.next /app/node_modules || true
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/.next /app/node_modules /private/uploads || true
fi

# ---- 0) Sanity checks ----
if [ -z "${DATABASE_URL:-}" ]; then
  echo "✖ DATABASE_URL is not set. Refusing to start."
  exit 1
fi

# ---- 0.1) Wait for database (optional but recommended) ----
WAIT_FOR_DB="${WAIT_FOR_DB:-true}"
DB_WAIT_SECONDS="${DB_WAIT_SECONDS:-60}"

# Defaults for readiness checks (can be overridden by env)
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-afct_user}"
DB_NAME="${DB_NAME:-afct}"

# Ensure private upload dirs exist (safe + idempotent)
mkdir -p /private/uploads/pfps \
         /private/uploads/problems \
         /private/uploads/solutions \
         /private/uploads/submissions || true

if [ "$WAIT_FOR_DB" = "true" ]; then
  echo "→ Waiting for database to be reachable (timeout: ${DB_WAIT_SECONDS}s)..."
  i=0

  # Prefer pg_isready if present (postgresql-client)
  if command -v pg_isready >/dev/null 2>&1; then
    # Use -h/-p/-U/-d (more reliable than passing DATABASE_URL to -d on Alpine)
    until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
      i=$((i+1))
      if [ "$i" -ge "$DB_WAIT_SECONDS" ]; then
        echo "✖ DB not ready (timeout after ${DB_WAIT_SECONDS}s) - host=${DB_HOST} port=${DB_PORT} user=${DB_USER} db=${DB_NAME}"
        exit 1
      fi
      sleep 1
    done
  else
    # Fallback to TCP port probe (requires nc)
    if ! command -v nc >/dev/null 2>&1; then
      echo "✖ Neither pg_isready nor nc is available to check DB readiness."
      exit 1
    fi
    until nc -z "$DB_HOST" "$DB_PORT" >/dev/null 2>&1; do
      i=$((i+1))
      if [ "$i" -ge "$DB_WAIT_SECONDS" ]; then
        echo "✖ DB not ready (timeout after ${DB_WAIT_SECONDS}s) - host=${DB_HOST} port=${DB_PORT}"
        exit 1
      fi
      sleep 1
    done
  fi

  echo "✓ Database is reachable"
else
  echo "→ WAIT_FOR_DB=false, skipping DB wait"
fi

# ---- 0.2) Ensure Prisma client exists (optional safety) ----
ENSURE_PRISMA_CLIENT="${ENSURE_PRISMA_CLIENT:-true}"
if [ "$ENSURE_PRISMA_CLIENT" = "true" ]; then
  if [ ! -d "node_modules/@prisma/client" ] || [ ! -f "node_modules/.prisma/client/index.js" ]; then
    echo "→ Prisma client missing; attempting to generate..."
    npx prisma generate || true
  else
    echo "✓ Prisma client appears present"
  fi
fi

# ---- 1) Apply migrations (idempotent) ----
MIGRATE_ON_START="${MIGRATE_ON_START:-true}"
if [ "$MIGRATE_ON_START" = "true" ]; then
  echo "→ Running prisma migrate deploy..."
  npx prisma migrate deploy
else
  echo "→ MIGRATE_ON_START=false, skipping migrations"
fi

# ---- 2) Optionally seed ----
SEED_ON_START="${SEED_ON_START:-auto}"
should_seed="false"
if [ "$SEED_ON_START" = "true" ]; then
  should_seed="true"
elif [ "$SEED_ON_START" = "auto" ] && [ "${NODE_ENV:-}" = "production" ]; then
  should_seed="true"
fi

if [ "$should_seed" = "true" ]; then
  echo "→ Running prisma db seed..."
  npx prisma db seed
else
  echo "→ SEED_ON_START=${SEED_ON_START}, skipping seed"
fi

# ---- 3) Start the app ----
echo "→ Starting app: $*"
exec "$@"
