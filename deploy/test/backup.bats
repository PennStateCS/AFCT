#!/usr/bin/env bats
#
# docker/backup/backup.sh: the script that writes, verifies, prunes and restores the archives.
#
# It had no tests at all, which made it the least-covered important thing in the repository: one
# archive holds the whole database plus both upload volumes, which is every student's work and
# record on the site. The bug that prompted these (a `grep -q` closing the verify pipe, so every
# successful backup logged "Broken pipe") was found by reading a production log, not by anything
# automated.
#
# The script is run exactly as shipped, as a background daemon driven by its trigger files, with
# `pg_dump`, `pg_restore` and `psql` stubbed on PATH. Nothing is sourced and no function is called
# directly, because the loop, the trigger handling and the ordering are part of what can break.
#
# Needs gpg and GNU tar, which the bats image lacks; installed the same way the suites already
# install jq.

setup_file() {
  apk add --no-cache gnupg tar coreutils >/dev/null 2>&1 || true
}

setup() {
  TESTDIR="$(mktemp -d)"
  export TESTDIR
  export BACKUP_DIR="$TESTDIR/backups"
  export BACKUP_TRIGGER_DIR="$TESTDIR/triggers"
  export BACKUP_FILES_ROOT="$TESTDIR/uploads"
  export BACKUP_HEARTBEAT_FILE="$TESTDIR/alive"
  export GNUPGHOME="$TESTDIR/gnupg"
  export TMPDIR="$TESTDIR/tmp"
  # Fast enough that a test finishes in a second, slow enough not to spin.
  export BACKUP_TICK_SECONDS=1
  # Never reach the scheduled branch: these tests drive the on-demand trigger, and a scheduled
  # run firing halfway through would make the assertions depend on the clock.
  export BACKUP_CHECK_SECONDS=86400
  export BACKUP_ENABLED=false

  mkdir -p "$BACKUP_DIR" "$BACKUP_TRIGGER_DIR" "$BACKUP_FILES_ROOT" "$TMPDIR" "$TESTDIR/bin"
  printf 'a submitted automaton\n' > "$BACKUP_FILES_ROOT/submission.jff"

  # Stubs. `pg_dump` writes a recognisable file so the archive's contents can be asserted;
  # `pg_restore` records that it was called and with what.
  cat > "$TESTDIR/bin/pg_dump" <<'STUB'
#!/bin/sh
out=""
while [ $# -gt 0 ]; do
  case "$1" in -f) out="$2"; shift 2 ;; *) shift ;; esac
done
[ -n "${PG_DUMP_FAIL:-}" ] && exit 1
[ -n "${PG_DUMP_EMPTY:-}" ] && exit 0
printf 'PGDMP fake dump payload\n' > "$out"
# Incompressible bulk on request. The broken-pipe regression only appears when the archive is
# big enough that closing the read end mid-listing kills the writer, so a few bytes of payload
# cannot reproduce it. /dev/urandom rather than zeros because gzip would flatten zeros back to
# nothing and the pipe would never fill.
[ -n "${PG_DUMP_BYTES:-}" ] && dd if=/dev/urandom bs=1M count="$PG_DUMP_BYTES" >> "$out" 2>/dev/null
exit 0
STUB
  cat > "$TESTDIR/bin/pg_restore" <<'STUB'
#!/bin/sh
[ -n "${PG_RESTORE_FAIL:-}" ] && exit 1
for a in "$@"; do case "$a" in */database.dump) echo "$a" > "$TESTDIR/restored-from" ;; esac; done
exit 0
STUB
  # The settings read is expected to fail in this harness; the script falls back to env.
  cat > "$TESTDIR/bin/psql" <<'STUB'
#!/bin/sh
exit 1
STUB
  chmod +x "$TESTDIR/bin/pg_dump" "$TESTDIR/bin/pg_restore" "$TESTDIR/bin/psql"
  export PATH="$TESTDIR/bin:$PATH"

  SCRIPT="$BATS_TEST_DIRNAME/../../docker/backup/backup.sh"
  export SCRIPT
}

teardown() {
  [ -n "${DAEMON_PID:-}" ] && kill "$DAEMON_PID" 2>/dev/null || true
  rm -rf "$TESTDIR"
}

# Run the script until `stop_when` succeeds, then stop it. Returns non-zero if it never did,
# so a test fails on a timeout instead of hanging.
run_until() {
  stop_when="$1"
  : > "$TESTDIR/log"
  # `3>&-` matters: bats keeps file descriptor 3 open for its own output, a background process
  # inherits it, and bats then waits for it to close. Without this the daemon holds the test
  # open until bats gives up and kills it, and every case fails with status 143 rather than
  # anything about backups.
  sh "$SCRIPT" > "$TESTDIR/log" 2>&1 3>&- &
  DAEMON_PID=$!
  i=0
  while [ "$i" -lt 60 ]; do
    if eval "$stop_when"; then
      # `|| true` on both: a process killed by SIGTERM makes `wait` return 143, and bats fails a
      # test on any non-zero command, so without this every case fails with 143 and says nothing
      # about backups.
      kill "$DAEMON_PID" 2>/dev/null || true
      wait "$DAEMON_PID" 2>/dev/null || true
      DAEMON_PID=''
      return 0
    fi
    sleep 0.5
    i=$((i + 1))
  done
  kill "$DAEMON_PID" 2>/dev/null || true
  DAEMON_PID=''
  echo "timed out waiting for: $stop_when"
  cat "$TESTDIR/log"
  return 1
}

# Whichever kind exists. `|| true` because `ls` exits non-zero when one of the two globs matches
# nothing, which is the normal case, and bats fails a test on any non-zero command.
archives() { ls "$BACKUP_DIR"/afct-*.tar.gz "$BACKUP_DIR"/afct-*.tar.gz.gpg 2>/dev/null || true; }

trigger_backup() { touch "$BACKUP_TRIGGER_DIR/backup-now"; }

@test "an on-demand backup writes one encrypted archive holding the dump and the uploads" {
  export BACKUP_ENCRYPTION_KEY=a-test-passphrase

  trigger_backup
  run_until '[ -n "$(archives)" ]'

  archive="$(archives)"
  [ "$(echo "$archive" | wc -l)" -eq 1 ]
  case "$archive" in *.tar.gz.gpg) ;; *) echo "expected a .gpg archive, got $archive"; return 1 ;; esac

  # Read it back the way a restore would, and check both halves are in there: a dump without the
  # uploads leaves dangling references, which is the reason they share one archive.
  printf '%s' "$BACKUP_ENCRYPTION_KEY" > "$TESTDIR/pass"
  run sh -c "gpg --batch --quiet --decrypt --passphrase-file '$TESTDIR/pass' --pinentry-mode loopback '$archive' | tar tzf -"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '^db/database\.dump$'
  echo "$output" | grep -q 'submission\.jff'
}

@test "a successful backup logs nothing that looks like a failure" {
  # The regression this guards: `grep -q` in the verify pass matched on the first entry and
  # exited with the rest of the archive still coming, which closed the pipe, gave tar SIGPIPE and
  # made gpg log "error writing to '-': Broken pipe" on every *successful* backup. Alarming lines
  # in the log an administrator reads when something has actually gone wrong, about the one thing
  # that had not.
  #
  # Honest limit: this does not reproduce that bug. Restoring `grep -q` in the script and
  # running this still passes, at a few bytes of dump and at 24 MB of incompressible data, so
  # something about gpg or grep in the test image does not race the way the production container
  # did. What is left is a general guard that a successful run says nothing alarming, which is
  # worth having and is not the same thing. The bulk below at least makes the verify pass read a
  # realistic archive rather than a thirty-byte one.
  export BACKUP_ENCRYPTION_KEY=a-test-passphrase
  export PG_DUMP_BYTES=8

  trigger_backup
  run_until '[ -n "$(archives)" ]'

  run grep -iE 'broken pipe|error|failed|warning' "$TESTDIR/log"
  [ "$status" -ne 0 ]
}

@test "an archive that does not verify is discarded rather than published" {
  # pg_dump succeeds but writes nothing, so the archive lacks the dump. A backup that only looks
  # written is worse than a failed one, because nobody goes looking.
  export BACKUP_ENCRYPTION_KEY=a-test-passphrase
  export PG_DUMP_EMPTY=1

  trigger_backup
  run_until 'grep -q "failed verification" "$TESTDIR/log"'

  [ -z "$(archives)" ]
  # And no half-written file left behind to be mistaken for one later.
  run sh -c "ls '$BACKUP_DIR'/.partial-* 2>/dev/null"
  [ "$status" -ne 0 ]
}

@test "a failed database dump takes no archive and says so" {
  export BACKUP_ENCRYPTION_KEY=a-test-passphrase
  export PG_DUMP_FAIL=1

  trigger_backup
  run_until 'grep -q "database dump failed" "$TESTDIR/log"'

  [ -z "$(archives)" ]
}

@test "no encryption key means no backup at all, and a message saying what to do" {
  # A missing key used to mean "write it in the clear". Nobody chooses that; they get it by not
  # knowing the variable exists.
  unset BACKUP_ENCRYPTION_KEY

  trigger_backup
  run_until 'grep -q "BACKUP_ENCRYPTION_KEY is not set" "$TESTDIR/log"'

  [ -z "$(archives)" ]
  run grep -q 'BACKUP_ALLOW_UNENCRYPTED=true' "$TESTDIR/log"
  [ "$status" -eq 0 ]
}

@test "an explicit opt-out writes a plaintext archive and warns every run" {
  unset BACKUP_ENCRYPTION_KEY
  export BACKUP_ALLOW_UNENCRYPTED=true

  trigger_backup
  run_until '[ -n "$(archives)" ]'

  archive="$(archives)"
  case "$archive" in *.tar.gz.gpg) echo "expected plaintext, got $archive"; return 1 ;; esac
  run tar tzf "$archive"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '^db/database\.dump$'

  run grep -q 'UNENCRYPTED' "$TESTDIR/log"
  [ "$status" -eq 0 ]
}

@test "retention removes archives past the window and keeps the recent one" {
  export BACKUP_ENCRYPTION_KEY=a-test-passphrase
  export BACKUP_RETENTION_DAYS=7

  # One well past the window, one inside it. Touched with explicit old timestamps, because
  # `find -mtime` is what the script prunes on.
  touch -d '30 days ago' "$BACKUP_DIR/afct-20260101-000000.tar.gz.gpg" 2>/dev/null \
    || touch -t 202601010000 "$BACKUP_DIR/afct-20260101-000000.tar.gz.gpg"
  touch -d '2 days ago' "$BACKUP_DIR/afct-20260810-000000.tar.gz.gpg" 2>/dev/null \
    || touch "$BACKUP_DIR/afct-20260810-000000.tar.gz.gpg"

  trigger_backup
  run_until 'grep -q "^\[backup\] wrote" "$TESTDIR/log"'

  [ ! -f "$BACKUP_DIR/afct-20260101-000000.tar.gz.gpg" ]
  [ -f "$BACKUP_DIR/afct-20260810-000000.tar.gz.gpg" ]
}

@test "a restore reads back an encrypted archive and hands the dump to pg_restore" {
  export BACKUP_ENCRYPTION_KEY=a-test-passphrase

  trigger_backup
  run_until '[ -n "$(archives)" ]'
  archive="$(archives)"
  ts="$(basename "$archive" | sed 's/^afct-//; s/\.tar\.gz\.gpg$//')"

  echo "$ts" > "$BACKUP_TRIGGER_DIR/restore-now"
  run_until '[ -f "$BACKUP_TRIGGER_DIR/restore-result" ]'

  run cat "$BACKUP_TRIGGER_DIR/restore-result"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '^ok '
  # It restored from the dump inside the archive, not from anything left lying around.
  run grep -q 'database.dump' "$TESTDIR/restored-from"
  [ "$status" -eq 0 ]
}

@test "a restore of a plaintext archive works too, since both kinds exist on disk" {
  unset BACKUP_ENCRYPTION_KEY
  export BACKUP_ALLOW_UNENCRYPTED=true

  trigger_backup
  run_until '[ -n "$(archives)" ]'
  ts="$(basename "$(archives)" | sed 's/^afct-//; s/\.tar\.gz$//')"

  echo "$ts" > "$BACKUP_TRIGGER_DIR/restore-now"
  run_until '[ -f "$BACKUP_TRIGGER_DIR/restore-result" ]'

  run cat "$BACKUP_TRIGGER_DIR/restore-result"
  echo "$output" | grep -q '^ok '
}

@test "a restore refuses a target that is not a timestamp" {
  # The target names a path under BACKUP_DIR, so anything else must not steer it elsewhere.
  export BACKUP_ENCRYPTION_KEY=a-test-passphrase

  printf '../../etc/passwd\n' > "$BACKUP_TRIGGER_DIR/restore-now"
  run_until '[ -f "$BACKUP_TRIGGER_DIR/restore-result" ]'

  run cat "$BACKUP_TRIGGER_DIR/restore-result"
  echo "$output" | grep -q 'invalid-target'
}

@test "a restore of a backup that is not there fails clearly rather than quietly" {
  export BACKUP_ENCRYPTION_KEY=a-test-passphrase

  echo '20200101-000000' > "$BACKUP_TRIGGER_DIR/restore-now"
  run_until '[ -f "$BACKUP_TRIGGER_DIR/restore-result" ]'

  run cat "$BACKUP_TRIGGER_DIR/restore-result"
  echo "$output" | grep -q 'backup-not-found'
}

@test "an encrypted archive cannot be restored without the key" {
  # The one failure that is unrecoverable rather than inconvenient, so it must say which.
  export BACKUP_ENCRYPTION_KEY=a-test-passphrase
  trigger_backup
  run_until '[ -n "$(archives)" ]'
  ts="$(basename "$(archives)" | sed 's/^afct-//; s/\.tar\.gz\.gpg$//')"

  unset BACKUP_ENCRYPTION_KEY
  echo "$ts" > "$BACKUP_TRIGGER_DIR/restore-now"
  run_until '[ -f "$BACKUP_TRIGGER_DIR/restore-result" ]'

  run cat "$BACKUP_TRIGGER_DIR/restore-result"
  echo "$output" | grep -q 'missing-key'
}

@test "a backup with no uploads mounted still archives the database" {
  export BACKUP_ENCRYPTION_KEY=a-test-passphrase
  rm -f "$BACKUP_FILES_ROOT"/*

  trigger_backup
  run_until '[ -n "$(archives)" ]'

  run grep -q 'no uploads mounted' "$TESTDIR/log"
  [ "$status" -eq 0 ]
  printf '%s' "$BACKUP_ENCRYPTION_KEY" > "$TESTDIR/pass"
  run sh -c "gpg --batch --quiet --decrypt --passphrase-file '$TESTDIR/pass' --pinentry-mode loopback '$(archives)' | tar tzf -"
  echo "$output" | grep -q '^db/database\.dump$'
}

@test "the heartbeat is stamped, which is what the container healthcheck reads" {
  export BACKUP_ENCRYPTION_KEY=a-test-passphrase

  run_until '[ -s "$BACKUP_HEARTBEAT_FILE" ]'

  run cat "$BACKUP_HEARTBEAT_FILE"
  [ "$status" -eq 0 ]
  echo "$output" | grep -qE '^[0-9]{10}$'
}
