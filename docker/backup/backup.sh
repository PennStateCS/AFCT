#!/bin/sh
# Daily Postgres + uploaded-file backups, scheduled from System Settings, with an
# on-demand "back up now" trigger from the dashboard.
#
# Each run writes ONE archive to $BACKUP_DIR and prunes anything past retention:
#   afct-<ts>.tar.gz.gpg   encrypted (BACKUP_ENCRYPTION_KEY set)
#   afct-<ts>.tar.gz       plaintext (no key configured)
#
# The archive holds both halves of a restorable snapshot, because DB rows reference
# uploads by name and restoring one without the other leaves dangling references:
#   db/database.dump   the database (pg_dump custom format)
#   ./...              the upload volumes mounted under $FILES_ROOT
#
# Encryption: gpg symmetric AES-256 with the passphrase from BACKUP_ENCRYPTION_KEY.
# A backup is a complete copy of every education record, so it should not sit on
# disk in the clear. WITHOUT THE PASSPHRASE THE BACKUP CANNOT BE RESTORED -- keep it
# somewhere other than this VM. If the variable is unset we still write the single
# archive, unencrypted, and log a warning each run rather than silently stopping.
#
# On-demand: the app drops a flag file in $TRIGGER_DIR; we back up within one tick.
# Scheduled: once per day at or after backupHour, read from SystemSettings (falls
# back to the BACKUP_* env defaults if the row can't be read).
#
# Manual restore (with the volumes mounted at /private/uploads and /app/public/uploads):
#   gpg --decrypt afct-<ts>.tar.gz.gpg | tar xzf - -C /tmp/restore   # or: tar xzf <archive>
#   pg_restore -h postgres -U afct_user -d afct --clean --if-exists /tmp/restore/db/database.dump
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

# Encryption passphrase. Kept in a 0600 file rather than passed as a gpg argument,
# because command lines are readable by any process in the container (ps).
ENC_KEY="${BACKUP_ENCRYPTION_KEY:-}"
KEYFILE=''
if [ -n "$ENC_KEY" ]; then
  # gpg 2.x needs a writable home to spawn its agent. Without one it does not
  # fail -- it HANGS, which would silently stall every backup, so pin it here
  # rather than relying on $HOME existing in the container.
  GNUPGHOME="${GNUPGHOME:-/tmp/afct-gnupg}"
  export GNUPGHOME
  mkdir -p "$GNUPGHOME"
  chmod 700 "$GNUPGHOME"

  KEYFILE="$(mktemp "${TMPDIR:-/tmp}/afct-backup-key.XXXXXX")"
  chmod 600 "$KEYFILE"
  printf '%s' "$ENC_KEY" > "$KEYFILE"
fi

# Wrappers so the encrypted and plaintext paths read the same at the call sites.
encrypt_to() { # stdin -> $1
  if [ -n "$KEYFILE" ]; then
    gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
      --passphrase-file "$KEYFILE" --pinentry-mode loopback -o "$1"
  else
    cat > "$1"
  fi
}
decrypt_from() { # $1 -> stdout
  if [ -n "$KEYFILE" ] && [ "${1##*.}" = "gpg" ]; then
    gpg --batch --quiet --decrypt --passphrase-file "$KEYFILE" --pinentry-mode loopback "$1"
  else
    cat "$1"
  fi
}

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

  if [ -z "$KEYFILE" ]; then
    log "WARNING: BACKUP_ENCRYPTION_KEY is not set - writing an UNENCRYPTED backup"
  fi

  work="$(mktemp -d "${TMPDIR:-/tmp}/afct-backup.XXXXXX")" || { log "no temp space"; return; }
  mkdir -p "$work/db"

  # 1) Database, staged into the work dir so it can go into the archive.
  log "dumping ${PGDATABASE}"
  if ! pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Fc \
       -f "$work/db/database.dump"; then
    log "database dump failed; skipping this run"
    rm -rf "$work"
    return
  fi

  # 2) One archive: the dump plus the upload volumes (when mounted and non-empty).
  #    Two -C sections rather than a staging copy, so uploads aren't duplicated on
  #    disk. GNU tar (installed in the image) is what supports repeating -C.
  set -- -C "$work" db
  if [ -d "$FILES_ROOT" ] && [ -n "$(ls -A "$FILES_ROOT" 2>/dev/null)" ]; then
    set -- "$@" -C "$FILES_ROOT" .
  else
    log "no uploads mounted; archiving database only"
  fi

  # The in-progress file keeps the real suffix (and a leading dot so it is never
  # mistaken for a finished backup): decrypt_from picks its mode from the
  # extension, so a plain ".partial" suffix would make the verify pass below feed
  # encrypted bytes to tar and reject every archive.
  out="${BACKUP_DIR}/afct-${ts}.tar.gz"
  tmp="${BACKUP_DIR}/.partial-afct-${ts}.tar.gz"
  if [ -n "$KEYFILE" ]; then
    out="${out}.gpg"
    tmp="${tmp}.gpg"
  fi

  log "writing archive"
  # tar's exit code is not the gate: it warns (non-zero) when a file changes
  # mid-read, which is harmless here. The verify pass below is the real check.
  tar czf - "$@" 2>/dev/null | encrypt_to "$tmp"

  # 3) Verify before publishing: read the archive back the way a restore would and
  #    confirm the database dump is actually in it. A backup that only *looks*
  #    written is worse than a failed one, because nobody goes looking.
  if [ ! -s "$tmp" ] || ! decrypt_from "$tmp" | tar tzf - 2>/dev/null | grep -q '^db/database\.dump$'; then
    log "archive failed verification; discarding"
    rm -f "$tmp"
    rm -rf "$work"
    return
  fi

  mv "$tmp" "$out"
  rm -rf "$work"
  log "wrote ${out} ($(du -h "$out" | cut -f1))${KEYFILE:+ [encrypted]}"

  # 4) Prune past the retention window.
  find "$BACKUP_DIR" \( -name 'afct-*.tar.gz' -o -name 'afct-*.tar.gz.gpg' \) -type f \
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
  archive=''
  for candidate in \
    "${BACKUP_DIR}/afct-${target}.tar.gz.gpg" \
    "${BACKUP_DIR}/afct-${target}.tar.gz"; do
    [ -f "$candidate" ] && { archive="$candidate"; break; }
  done
  if [ -z "$archive" ]; then
    log "restore: backup ${target} not found"
    write_restore_result "failed" "backup-not-found"
    return
  fi
  if [ "${archive##*.}" = "gpg" ] && [ -z "$KEYFILE" ]; then
    log "restore: ${target} is encrypted but BACKUP_ENCRYPTION_KEY is not set"
    write_restore_result "failed" "missing-key"
    return
  fi

  work="$(mktemp -d "${TMPDIR:-/tmp}/afct-restore.XXXXXX")" || {
    write_restore_result "failed" "no-temp-space"; return; }
  log "extracting ${archive}"
  # Only the dump is needed: a downgrade restores the schema + data the old app
  # version expects, and leaves uploads alone (see the note above).
  if ! decrypt_from "$archive" | tar xzf - -C "$work" db/database.dump 2>/dev/null; then
    log "restore: could not extract ${target} (wrong key, or corrupt archive)"
    rm -rf "$work"
    write_restore_result "failed" "extract-failed"
    return
  fi
  db_file="$work/db/database.dump"

  log "restoring database from ${target} (the app must already be stopped)"
  if pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
       --clean --if-exists --no-owner "$db_file"; then
    log "database restore from ${target} complete"
    write_restore_result "ok" "$target"
  else
    log "database restore from ${target} FAILED"
    write_restore_result "failed" "restore-error"
  fi
  [ -n "$work" ] && rm -rf "$work"
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
