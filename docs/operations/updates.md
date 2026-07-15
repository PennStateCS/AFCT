# Update AFCT

Create or confirm a current backup before applying an update.

## Guided-installer deployment

Open the directory that contains `docker-compose.yml`, then run:

```bash
docker compose pull
docker compose up -d
```

The same commands work in Windows PowerShell.

`docker compose pull` downloads the images named in the Compose file. `docker compose up -d` recreates only the services whose image or configuration changed.

## Git-based manual deployment

Open the cloned AFCT repository and run:

```bash
git pull
docker compose pull
docker compose up -d
```

The commands are the same on Linux, macOS, and Windows PowerShell.

Named volumes preserve the database, uploaded files, backups, and certificates while containers are replaced.

## Verify the update

```bash
docker compose ps
docker compose logs --tail=100 app
```

Confirm that every service is running and the application reports healthy. Then sign in and open an administration page.

One-click updates from the AFCT interface are planned but are not currently available.
