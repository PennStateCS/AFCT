# Backups and recovery

AFCT's `afct-db-backup` service writes one archive per run, holding the database and the uploaded files for the same point in time. They travel together because database records refer to uploaded files by name.

The archive is named:

- `afct-YYYYMMDD-HHMMSS.tar.gz.gpg` when backup encryption is configured, or
- `afct-YYYYMMDD-HHMMSS.tar.gz` when it is not

and contains:

- `db/database.dump`, a custom-format PostgreSQL dump
- the public and private upload volumes (omitted when no uploads are mounted)

Archives are stored in the `db_backups` Docker volume. Each one is verified immediately after it is written (read back, decrypted, and checked for the database dump) and discarded if that fails, so a corrupt archive is never left looking like a good backup.

## Encrypt backups

A backup is a complete copy of every education record, so it should not sit on disk in the clear.

**The installer generates `BACKUP_ENCRYPTION_KEY` for you**, on a new install and when updating an older one, so encryption is on without anyone having to know the setting exists. The backup service encrypts each archive with GnuPG symmetric AES-256. There is nothing to do unless you want to set your own passphrase, in which case put one in `.env.production`:

```bash
openssl rand -base64 48
```

The installer never replaces a passphrase that is already there. Replacing it would make every archive already written unreadable, which is the one unrecoverable mistake available here.

:::danger Store the passphrase off this server
Without the passphrase the backups **cannot be restored**, not by you, not by anyone. Keep it in a password manager or another system, not only on the AFCT host, and not only in `.env.production` (which is on the same disk as the backups it protects).
:::

### If there is no passphrase

A backup is **not taken**, and the service logs why. It used to write the archive unencrypted with a warning, which is the wrong way round: a backup that did not happen shows up on the Backups tab and in the log, while a plaintext copy of the whole site shows up nowhere until it is somewhere it should not be.

If you genuinely want plaintext archives, because the volume underneath is encrypted or you ship them somewhere that encrypts them, say so deliberately:

```bash
BACKUP_ALLOW_UNENCRYPTED=true
```

With that set the installer stops generating a passphrase and the service writes the archive in the clear, with a warning on every run. The Backups tab shows each archive's encryption state either way.

To decrypt an archive by hand:

```bash
gpg --decrypt afct-20260101-020000.tar.gz.gpg | tar xzf - -C /tmp/restore
```

## When a backup actually happens

The schedule is a daily one, not a precise clock. The backup service checks periodically and runs
once a day at the first check where the current hour has reached the hour you set. One
consequence surprises people: **starting the container after the configured hour backs up
immediately**, because that day's backup has not happened yet.

Retention prunes by the age of the file on disk, so an archive you copied off the server and back
again looks newer than it is.

## Configure backups

Sign in as an administrator and open **Administration > System Settings > Backups**. You can enable or disable the daily schedule, select the UTC hour, set retention from 1 to 365 days, or choose **Back up now**.

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

## Restore a full backup

There is no restore button. A full recovery is done from a terminal on the server, and it is
short enough to read in one go. You need the archive, the passphrase it was encrypted with, and
`gpg` installed on the machine you unpack it on.

The paths below are the Linux ones. On macOS the deployment lives under `$HOME/.afct` instead of
`/opt/afct`.

**Practice this on a spare machine before you need it**, decryption included. A passphrase you
cannot produce under pressure is the same as having no backup at all.

1. **Stop the services that write**, so nothing changes underneath you:

   ```bash
   sudo afctctl stop
   ```

2. **Unpack the archive**, decrypting it if the name ends in `.gpg`. You are asked for the
   passphrase:

   ```bash
   mkdir -p /tmp/restore
   gpg --decrypt afct-20260101-020000.tar.gz.gpg | tar xzf - -C /tmp/restore
   ```

   A plain `.tar.gz` needs only `tar xzf afct-20260101-020000.tar.gz -C /tmp/restore`.

3. **Start the database on its own** and put the dump back:

   ```bash
   docker compose -p afct \
     --env-file /opt/afct/shared/.env.production \
     -f /opt/afct/shared/runtime/docker-compose.yml up -d postgres

   docker cp /tmp/restore/db/database.dump afct-postgres:/tmp/database.dump
   docker exec afct-postgres \
     pg_restore -U afct_user -d afct --clean --if-exists --no-owner /tmp/database.dump
   ```

4. **Put the uploaded files back.** The archive holds them in two directories, matching the two
   volumes they came from:

   **Check the volume names first.** Compose prefixes them with the project name, so they are
   `afct_private_uploads` and `afct_uploads_data`, not the bare names in the compose file:

   ```bash
   docker volume ls | grep uploads
   ```

   Use exactly what that prints. A name that does not exist is not an error: Docker creates an
   empty volume, every command below succeeds, and the uploads are silently not restored.

   ```bash
   docker run --rm -v afct_private_uploads:/dest -v /tmp/restore:/src alpine \
     cp -a /src/private-uploads/. /dest/
   docker run --rm -v afct_uploads_data:/dest -v /tmp/restore:/src alpine \
     cp -a /src/public-uploads/. /dest/
   ```

5. **Bring everything back up and check it**:

   ```bash
   sudo afctctl restart
   sudo afctctl status
   ```

   Then sign in and confirm accounts, courses, submissions and grades are there, and that a
   submitted file actually downloads.

6. **Delete `/tmp/restore`.** It holds every education record in the installation, in the clear.

Restore both parts from the same archive. Restoring only the database can leave missing or mismatched files, and restoring only the uploads can leave files that the database does not reference.

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

Stop everything that writes first, the evaluator worker included, not just the app. Confirm the
target database and keep a copy of its current state.

### Linux or macOS

```bash
sudo afctctl stop
docker compose -p afct --env-file /opt/afct/shared/.env.production \
  -f /opt/afct/shared/runtime/docker-compose.yml up -d postgres
docker exec -i afct-postgres psql -U afct_user afct < backup.sql
sudo afctctl restart
```

### Windows PowerShell

```powershell
afctctl.ps1 stop
docker start afct-postgres
cmd /c "docker exec -i afct-postgres psql -U afct_user afct < backup.sql"
afctctl.ps1 restart
```

Test sign-in and course data after the services become healthy.
