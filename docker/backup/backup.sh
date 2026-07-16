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
# Restore (downgrade) request from the updater: the file holds the backup timestamp
# to restore; we write the outcome to the result file for the updater to read.
RESTORE_TRIGGER_FILE="${TRIGGER_DIR}/restore-now"
RESTORE_RESULT_FILE="${TRIGGER_DIR}/restore-result"
LAST_RUN_FILE="${BACKUP_DIR}/.last-backup-date"
TICK="${BACKUP_TICK_SECONDS:-10}"                  # trigger poll cadence
SETTINGS_EVERY="${BACKUP_CHECK_SECONDS:-900}"      # settings/schedule cadence

# Fallbacks used only when the settings row can't be read.
FALLBACK_ENABLED="${BACKUP_ENABLED:-true}"
FALLBACK_HOUR="${BACKUP_HOUR:-2}"
FALLBACK_RETENTION="${BACKUP_RETENTION_DAYS:-14}"

# Liveness heartbeat for the container healthcheck: each loop tick stamps the
# current epoch here so the healthcheck can tell a live scheduler from a hung one.
HEARTBEAT_FILE="${BACKUP_HEARTBEAT_FILE:-/tmp/afct-backup.alive}"
beat() { date +%s > "$HEARTBEAT_FILE" 2>/dev/null || true; }

mkdir -p "$BACKUP_DIR"
[ -d "$TRIGGER_DIR" ] || mkdir -p "$TRIGGER_DIR" 2>/dev/null || true
beat
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

# Restore the database from a chosen backup, on request from the updater during a
# downgrade. The updater stops the app FIRST so pg_restore --clean can drop and
# recreate objects without live connections. Database only: a downgrade needs the
# schema + data the old app version expects; uploaded files are left untouched (any
# created since the backup simply become orphaned, which is harmless).
write_restore_result() {
  printf '%s %s\n' "$1" "${2:-}" > "${RESTORE_RESULT_FILE}.tmp" 2>/dev/null || return 0
  mv "${RESTORE_RESULT_FILE}.tmp" "$RESTORE_RESULT_FILE" 2>/dev/null || true
}

run_restore() {
  target="$1"
  # Timestamp only (YYYYMMDD-HHMMSS shape); reject anything else so the path can't
  # be steered outside BACKUP_DIR.
  case "$target" in
    '' | *[!0-9-]*) log "restore: invalid target"; write_restore_result "failed" "invalid-target"; return ;;
  esac
  db_file="${BACKUP_DIR}/afct-${target}.dump"
  if [ ! -f "$db_file" ]; then
    log "restore: backup ${target} not found"
    write_restore_result "failed" "backup-not-found"
    return
  fi

  log "restoring database from ${db_file} (the app must already be stopped)"
  if pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
       --clean --if-exists --no-owner "$db_file"; then
    log "database restore from ${target} complete"
    write_restore_result "ok" "$target"
  else
    log "database restore from ${target} FAILED"
    write_restore_result "failed" "restore-error"
  fi
}

# Cached retention for on-demand pruning; refreshed on each scheduled check.
cached_retention="$FALLBACK_RETENTION"
elapsed="$SETTINGS_EVERY"  # force a settings/schedule check on the first iteration

while true; do
  beat
  # Restore requested by the updater (downgrade). Handled before the backup check so
  # a restore is never delayed behind a scheduled backup.
  if [ -f "$RESTORE_TRIGGER_FILE" ]; then
    restore_target="$(tr -cd '0-9-' < "$RESTORE_TRIGGER_FILE" 2>/dev/null || echo '')"
    rm -f "$RESTORE_TRIGGER_FILE"
    log "restore requested: ${restore_target}"
    run_restore "$restore_target"
  fi

  # On-demand backup requested from the dashboard. Runs regardless of the on/off
  # setting; it's an explicit admin action.
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
