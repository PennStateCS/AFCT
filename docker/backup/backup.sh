#!/bin/sh
# Daily Postgres + uploaded-file backups, scheduled from System Settings, with an
# on-demand "back up now" trigger from the dashboard.
#
# Each run writes a matched pair to $BACKUP_DIR and prunes anything past retention:
#   afct-<ts>.dump        the database (custom format)
#   afct-files-<ts>.tgz   the upload volumes mounted under $FILES_ROOT
# The pair matters: DB rows reference files by name, so restoring one without the
# other leaves dangling references.
#
# On-demand: the app drops a flag file in $TRIGGER_DIR; we back up within one tick.
# Scheduled: once per day at or after backupHour, read from SystemSettings (falls
# back to the BACKUP_* env defaults if the row can't be read).
#
# Restore (with the volumes mounted at /private/uploads and /app/public/uploads):
#   pg_restore -h postgres -U afct_user -d afct --clean --if-exists <dump>
#   tar xzf <files-tgz> -C /tmp/restore
#   cp -a /tmp/restore/private-uploads/. /private/uploads/
#   cp -a /tmp/restore/public-uploads/.  /app/public/uploads/
set -eu

log() { echo "[backup] $*"; }

: "${PGHOST:=postgres}"
: "${PGPORT:=5432}"
: "${PGUSER:=afct_user}"
: "${PGDATABASE:=afct}"
export PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-}}"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
FILES_ROOT="${BACKUP_FILES_ROOT:-/snapshot}"       # upload volumes mounted here
TRIGGER_DIR="${BACKUP_TRIGGER_DIR:-/backup-triggers}"
TRIGGER_FILE="${TRIGGER_DIR}/backup-now"
LAST_RUN_FILE="${BACKUP_DIR}/.last-backup-date"
TICK="${BACKUP_TICK_SECONDS:-10}"                  # trigger poll cadence
SETTINGS_EVERY="${BACKUP_CHECK_SECONDS:-900}"      # settings/schedule cadence

# Fallbacks used only when the settings row can't be read.
FALLBACK_ENABLED="${BACKUP_ENABLED:-true}"
FALLBACK_HOUR="${BACKUP_HOUR:-2}"
FALLBACK_RETENTION="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
[ -d "$TRIGGER_DIR" ] || mkdir -p "$TRIGGER_DIR" 2>/dev/null || true
log "watching schedule + on-demand triggers"

# Echoes "enabled|hour|retention" from SystemSettings, or nothing on failure.
read_settings() {
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -tA -F '|' \
    -c 'SELECT "backupEnabled", "backupHour", "backupRetentionDays" FROM "SystemSettings" WHERE id = 1' \
    2>/dev/null || true
}

run_backup() {
  retention="$1"
  ts="$(date +%Y%m%d-%H%M%S)"

  # 1) Database.
  db_file="${BACKUP_DIR}/afct-${ts}.dump"
  db_tmp="${db_file}.partial"
  log "dumping ${PGDATABASE}"
  if pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Fc -f "$db_tmp"; then
    mv "$db_tmp" "$db_file"
    log "wrote ${db_file} ($(du -h "$db_file" | cut -f1))"
  else
    log "database dump failed; skipping this run"
    rm -f "$db_tmp"
    return
  fi

  # 2) Uploaded files (only if the volumes are mounted and non-empty).
  if [ -d "$FILES_ROOT" ] && [ -n "$(ls -A "$FILES_ROOT" 2>/dev/null)" ]; then
    files_file="${BACKUP_DIR}/afct-files-${ts}.tgz"
    files_tmp="${files_file}.partial"
    log "archiving uploads"
    # Judge success by a non-empty archive, not tar's exit code: tar warns
    # (non-zero) if a file changes mid-read, which is harmless for our uploads.
    tar czf "$files_tmp" -C "$FILES_ROOT" . 2>/dev/null || true
    if [ -s "$files_tmp" ]; then
      mv "$files_tmp" "$files_file"
      log "wrote ${files_file} ($(du -h "$files_file" | cut -f1))"
    else
      log "file archive failed"
      rm -f "$files_tmp"
    fi
  fi

  # 3) Prune dumps and file archives past the retention window.
  find "$BACKUP_DIR" \( -name 'afct-*.dump' -o -name 'afct-files-*.tgz' \) -type f \
    -mtime "+${retention}" -exec rm -f {} + 2>/dev/null || true
}

# Cached retention for on-demand pruning; refreshed on each scheduled check.
cached_retention="$FALLBACK_RETENTION"
elapsed="$SETTINGS_EVERY"  # force a settings/schedule check on the first iteration

while true; do
  # On-demand backup requested from the dashboard. Runs regardless of the on/off
  # setting — it's an explicit admin action.
  if [ -f "$TRIGGER_FILE" ]; then
    rm -f "$TRIGGER_FILE"
    log "on-demand backup requested"
    run_backup "$cached_retention"
  fi

  # Scheduled daily check (slower cadence to keep DB connections light).
  if [ "$elapsed" -ge "$SETTINGS_EVERY" ]; then
    elapsed=0
    row="$(read_settings)"
    if [ -n "$row" ]; then
      enabled="$(echo "$row" | cut -d'|' -f1)"
      hour="$(echo "$row" | cut -d'|' -f2)"
      retention="$(echo "$row" | cut -d'|' -f3)"
    else
      enabled="$FALLBACK_ENABLED"
      hour="$FALLBACK_HOUR"
      retention="$FALLBACK_RETENTION"
    fi
    cached_retention="$retention"

    case "$enabled" in
      t | true | TRUE | 1)
        now_hour=$((10#$(date +%H)))
        today="$(date +%Y-%m-%d)"
        last_run="$(cat "$LAST_RUN_FILE" 2>/dev/null || echo '')"
        if [ "$last_run" != "$today" ] && [ "$now_hour" -ge "$((10#$hour))" ]; then
          run_backup "$retention"
          echo "$today" > "$LAST_RUN_FILE"
        fi
        ;;
      *)
        : # scheduled backups disabled
        ;;
    esac
  fi

  sleep "$TICK"
  elapsed=$((elapsed + TICK))
done
