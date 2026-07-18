# Backups and recovery

AFCT's `afct-db-backup` service creates a database dump and an uploaded-file archive for the same point in time. Keep the pair together because database records refer to uploaded files by name.

The files use these names:

- `afct-YYYYMMDD-HHMMSS.dump`, a custom-format PostgreSQL dump
- `afct-files-YYYYMMDD-HHMMSS.tgz`, an archive of the public and private upload volumes

They are stored in the `db_backups` Docker volume. The file archive is omitted when there are no mounted uploads to archive.

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

The Backups tab lists the files available to the application and lets an administrator download them. Download both files with the same timestamp. This is useful for a quick off-host copy, but it is not a restore action.

## Restore planning

The current interface does not provide a general full-backup restore button. A full recovery is a host-administration procedure:

1. Preserve the current database and upload volumes before changing them.
2. Stop the `app` and `db-backup` services so no writes occur during the restore.
3. Restore the selected `.dump` with `pg_restore --clean --if-exists --no-owner` into the `afct` database.
4. Restore the matching `.tgz` content into the public and private upload volumes.
5. Start the stack, wait for health checks, and verify accounts, courses, submissions, grades, and downloadable files.

Practice this procedure on a separate recovery deployment first. Restoring only the database can leave missing or mismatched files. Restoring only the upload archive can leave files that the database does not reference.

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
