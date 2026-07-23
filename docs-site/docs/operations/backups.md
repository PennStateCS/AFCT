# Backups and recovery

AFCT's `afct-db-backup` service writes one archive per run, holding the database and the uploaded files for the same point in time. They travel together because database records refer to uploaded files by name.

The archive is named:

- `afct-YYYYMMDD-HHMMSS.tar.gz.gpg` when backup encryption is configured, or
- `afct-YYYYMMDD-HHMMSS.tar.gz` when it is not

and contains:

- `db/database.dump`, a custom-format PostgreSQL dump
- the public and private upload volumes (omitted when no uploads are mounted)

Archives are stored in the `db_backups` Docker volume. Each one is verified immediately after it is written — read back, decrypted, and checked for the database dump — and discarded if that fails, so a corrupt archive is never left looking like a good backup.

## Encrypt backups

A backup is a complete copy of every education record, so it should not sit on disk in the clear.

Set `BACKUP_ENCRYPTION_KEY` in `.env.production` to a long random passphrase. The backup service encrypts each archive with GnuPG symmetric AES-256:

```bash
openssl rand -base64 48
```

:::danger Store the passphrase off this server
Without the passphrase the backups **cannot be restored** — not by you, not by anyone. Keep it in a password manager or another system, not only on the AFCT host, and not only in `.env.production` (which is on the same disk as the backups it protects).
:::

If the variable is unset, backups are still written, but unencrypted, and the service logs a warning on every run. The Backups tab shows each archive's encryption state.

To decrypt an archive by hand:

```bash
gpg --decrypt afct-20260101-020000.tar.gz.gpg | tar xzf - -C /tmp/restore
```

## Configure backups

Sign in as an administrator and open **Admin Menu > System Settings > Backups**. You can enable or disable the daily schedule, select the UTC hour, set retention from 1 to 365 days, or choose **Back up now**.

The default schedule is enabled at 02:00 UTC with 14 days of retention. The backup service checks stored settings periodically, so a schedule change does not require a restart.

## Keep an off-host copy

A backup on the AFCT host does not protect against loss of that host or disk.

### Linux or macOS

Run this command from the directory where you want the archive:

```bash
docker run --rm \
  -v afct_db_backups:/backups:ro \
  -v "$PWD":/output \
  alpine \
  tar czf /output/afct-backups.tar.gz -C /backups .
```

### Windows PowerShell

```powershell
$outputPath = (Get-Location).Path

docker run --rm `
  -v afct_db_backups:/backups:ro `
  -v "${outputPath}:/output" `
  alpine `
  tar czf /output/afct-backups.tar.gz -C /backups .
```

The volume prefix can differ when Compose uses a project name other than `afct`. Run `docker volume ls` and identify the volume mounted at `/backups` in `afct-db-backup` if the example name is not present.

Protect the exported archive because it contains account data, grades, submissions, and uploaded files.

## Download a backup from AFCT

The Backups tab lists the archives available to the application and lets an administrator download them. One archive is a complete copy, so a single download is enough. This is useful for a quick off-host copy, but it is not a restore action.

## Restore planning

The current interface does not provide a general full-backup restore button. A full recovery is a host-administration procedure:

1. Preserve the current database and upload volumes before changing them.
2. Stop the `app` and `db-backup` services so no writes occur during the restore.
3. Unpack the archive, decrypting it first if it ends in `.gpg`:
   ```bash
   gpg --decrypt afct-20260101-020000.tar.gz.gpg | tar xzf - -C /tmp/restore
   ```
4. Restore `db/database.dump` with `pg_restore --clean --if-exists --no-owner` into the `afct` database.
5. Copy the upload directories from the same archive into the public and private upload volumes.
6. Start the stack, wait for health checks, and verify accounts, courses, submissions, grades, and downloadable files.

Practice this procedure on a separate recovery deployment first, including the decryption step — a passphrase you cannot produce under pressure is the same as no backup. Restoring only the database can leave missing or mismatched files. Restoring only the uploads can leave files that the database does not reference.

The updater's downgrade workflow is different. It restores the selected database restore point but deliberately leaves uploaded files in place.

## Create a separate database-only dump

This does not include uploads. The `--clean` statements make it suitable for restoring over the same schema after the application has been stopped.

### Linux or macOS

```bash
docker exec afct-postgres \
  pg_dump -U afct_user --clean --if-exists afct > backup.sql
```

### Windows PowerShell

```powershell
cmd /c "docker exec afct-postgres pg_dump -U afct_user --clean --if-exists afct > backup.sql"
```

## Restore a database-only dump

Stop application writes first. Confirm the target database and keep a copy of its current state.

### Linux or macOS

```bash
docker compose stop app db-backup
docker exec -i afct-postgres psql -U afct_user afct < backup.sql
docker compose up -d
```

### Windows PowerShell

```powershell
docker compose stop app db-backup
cmd /c "docker exec -i afct-postgres psql -U afct_user afct < backup.sql"
docker compose up -d
```

Test sign-in and course data after the services become healthy.
