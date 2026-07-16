# Backups and recovery

AFCT includes the `afct-db-backup` service. Each scheduled backup contains a matched database dump and uploaded-file archive. Keep both parts together because database records may refer to uploaded files by name.

Backups are stored in the `db_backups` Docker volume.

## Configure automatic backups

Sign in as an administrator and open **System Settings**. Configure:

- Whether automatic backups are enabled
- The hour backups run
- The number of days backups are retained

You can also start an immediate backup from the same page.

## Keep an off-host copy

A backup stored only on the AFCT host does not protect against a disk or server failure.

### Linux or macOS

Run this command from the directory where you want the archive:

```bash
docker run --rm   -v afct_db_backups:/backups   -v "$PWD":/output   alpine   tar czf /output/afct-backups.tar.gz -C /backups .
```

Confirm the file exists:

```bash
ls -lh afct-backups.tar.gz
```

### Windows PowerShell

Run this command from the directory where you want the archive:

```powershell
$outputPath = (Get-Location).Path

docker run --rm `
  -v afct_db_backups:/backups `
  -v "${outputPath}:/output" `
  alpine `
  tar czf /output/afct-backups.tar.gz -C /backups .
```

Confirm the file exists:

```powershell
Get-Item .\afct-backups.tar.gz
```

Store off-host copies in a protected location.

## Create a database-only dump

A database-only dump does not include uploaded files. Use the automatic backup system for a complete backup.

### Linux or macOS

```bash
docker exec afct-postgres   pg_dump -U afct_user afct > backup.sql
```

### Windows PowerShell

```powershell
cmd /c "docker exec afct-postgres pg_dump -U afct_user afct > backup.sql"
```

## Restore a database-only dump

Restoring can overwrite or conflict with existing records. Confirm the target database before continuing.

### Linux or macOS

```bash
docker exec -i afct-postgres   psql -U afct_user afct < backup.sql
```

### Windows PowerShell

```powershell
cmd /c "docker exec -i afct-postgres psql -U afct_user afct < backup.sql"
```

## Recovery practice

Test the restore process before an emergency. A backup is useful only when the team knows where it is, what it contains, and how to restore it.
