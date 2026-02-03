#!/bin/sh
set -e

# Error handling
trap 'echo "✖ Entrypoint script failed"; exit 1' ERR

# Define color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging helper
log_info() {
  echo "→ $1"
}

log_success() {
  echo "✓ $1"
}

log_error() {
  echo "✖ $1" >&2
}

# Export for use in subshells
export -f log_info log_success log_error

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

# ---- 0) Sanity checks ----
if [ -z "${DATABASE_URL:-}" ]; then
  log_error "DATABASE_URL is not set. Refusing to start."
  exit 1
fi

log_success "DATABASE_URL is configured"

# ---- 0.1) Ensure private upload dirs exist ----
UPLOAD_DIR="/private/uploads"
UPLOAD_SUBDIRS="pfps problems solutions submissions"

log_info "Creating upload directories..."
if mkdir -p "$UPLOAD_DIR"/{pfps,problems,solutions,submissions} 2>/dev/null; then
  log_success "Upload directories ready"
else
  log_error "Failed to create upload directories in $UPLOAD_DIR"
  exit 1
fi

# ---- 0.2) Wait for database (optional but recommended) ----
WAIT_FOR_DB="${WAIT_FOR_DB:-true}"
DB_WAIT_SECONDS="${DB_WAIT_SECONDS:-60}"

# Defaults for readiness checks (can be overridden by env)
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-afct_user}"
DB_NAME="${DB_NAME:-afct}"

if [ "$WAIT_FOR_DB" = "true" ]; then
  log_info "Waiting for database to be reachable (timeout: ${DB_WAIT_SECONDS}s)..."
  i=0

  # Prefer pg_isready if present (postgresql-client)
  if command -v pg_isready >/dev/null 2>&1; then
    # Use -h/-p/-U/-d (more reliable than passing DATABASE_URL to -d on Alpine)
    until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
      i=$((i+1))
      if [ "$i" -ge "$DB_WAIT_SECONDS" ]; then
        log_error "DB not ready (timeout after ${DB_WAIT_SECONDS}s) - host=${DB_HOST} port=${DB_PORT} user=${DB_USER} db=${DB_NAME}"
        exit 1
      fi
      sleep 1
    done
  else
    # Fallback to TCP port probe (requires nc)
    if ! command -v nc >/dev/null 2>&1; then
      log_error "Neither pg_isready nor nc is available to check DB readiness"
      exit 1
    fi
    until nc -z "$DB_HOST" "$DB_PORT" >/dev/null 2>&1; do
      i=$((i+1))
      if [ "$i" -ge "$DB_WAIT_SECONDS" ]; then
        log_error "DB not ready (timeout after ${DB_WAIT_SECONDS}s) - host=${DB_HOST} port=${DB_PORT}"
        exit 1
      fi
      sleep 1
    done
  fi

  log_success "Database is reachable"
else
  log_info "WAIT_FOR_DB=false, skipping DB wait"
fi

# ---- 0.3) Ensure Prisma client exists (optional safety) ----
ENSURE_PRISMA_CLIENT="${ENSURE_PRISMA_CLIENT:-true}"
if [ "$ENSURE_PRISMA_CLIENT" = "true" ]; then
  if [ ! -d "node_modules/@prisma/client" ] || [ ! -f "node_modules/.prisma/client/index.js" ]; then
    log_info "Prisma client missing; generating..."
    if npx prisma generate; then
      log_success "Prisma client generated successfully"
    else
      log_error "Failed to generate Prisma client"
      exit 1
    fi
  else
    log_success "Prisma client present"
  fi
fi

# ---- 1) Apply migrations (idempotent) ----
MIGRATE_ON_START="${MIGRATE_ON_START:-true}"
if [ "$MIGRATE_ON_START" = "true" ]; then
  log_info "Running prisma migrate deploy..."
  if npx prisma migrate deploy; then
    log_success "Migrations completed"
  else
    log_error "Migration failed"
    exit 1
  fi
else
  log_info "MIGRATE_ON_START=false, skipping migrations"
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
  log_info "Running prisma db seed..."
  if npx prisma db seed; then
    log_success "Database seeded successfully"
  else
    log_error "Seeding failed"
    exit 1
  fi
else
  log_info "SEED_ON_START=${SEED_ON_START}, skipping seed"
fi

# ---- 3) Start the app ----
log_info "Starting app: $*"
exec "$@"
