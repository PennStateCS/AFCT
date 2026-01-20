#!/bin/sh
set -e

# ---- 0) Sanity checks ----
if [ -z "${DATABASE_URL:-}" ]; then
  echo "✖ DATABASE_URL is not set. Refusing to start."
  exit 1
fi

# ---- 0.1) Optional: lightweight wait-for-DB (skip if Compose healthcheck already used) ----
if [ "${WAIT_FOR_DB:-true}" = "true" ]; then
  echo "→ Waiting for database to be reachable…"
  # Try pg_isready if available, else fall back to TCP check
  if command -v pg_isready >/dev/null 2>&1; then
    i=0
    until pg_isready -d "${DATABASE_URL}" >/dev/null 2>&1; do
      i=$((i+1)); [ $i -gt 60 ] && echo "✖ DB not ready (timeout)" && exit 1
      sleep 1
    done
  else
    # crude TCP wait using nc; requires host/port envs if you want to use it
    DB_HOST="${DB_HOST:-postgres}"
    DB_PORT="${DB_PORT:-5432}"
    i=0
    until nc -z "$DB_HOST" "$DB_PORT" >/dev/null 2>&1; do
      i=$((i+1)); [ $i -gt 60 ] && echo "✖ DB not ready (timeout)" && exit 1
      sleep 1
    done
  fi
fi

# ---- 0.2) Optional: ensure Prisma Client exists on fresh container start ----
if [ ! -d "node_modules/@prisma/client" ] || [ ! -f "node_modules/.prisma/client/index.js" ]; then
  echo "→ Prisma client missing; generating…"
  npx prisma generate || true
fi

# ---- 1) Apply migrations (idempotent) ----
if [ "${MIGRATE_ON_START:-true}" = "true" ]; then
  echo "→ Running prisma migrate deploy…"
  npx prisma migrate deploy
fi

# ---- 2) Optionally seed (explicit only) ----
if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "→ Running prisma db seed…"
  npx prisma db seed
fi

# ---- 3) Hand off to the main process (exactly one) ----
echo "→ Starting app: $@"
exec "$@"