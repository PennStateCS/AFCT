# Update AFCT

Create or confirm a current backup before applying an update.

## Guided-installer deployment

On Linux or macOS, open the directory that contains `docker-compose.yml` and run:

```bash
sh install.sh update
```

This records the currently deployed image versions, pulls the latest images, recreates the stack, and waits for the health check. If the new version does not become healthy, it automatically rolls back to the previous images and restores service.

The equivalent Docker commands work on any platform, including Windows PowerShell:

```bash
docker compose pull
docker compose up -d
```

`docker compose pull` downloads the images named in the Compose file. `docker compose up -d` recreates only the services whose image or configuration changed. Unlike `sh install.sh update`, these commands do not verify health or roll back automatically.

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

`sh install.sh update` already waits for the health check, but you can confirm at any time:

```bash
sh install.sh status
```

Or with Docker directly:

```bash
docker compose ps
docker compose logs --tail=100 app
```

Confirm that every service is running and the application reports healthy. Then sign in and open an administration page.

One-click updates from the AFCT interface are planned but are not currently available.
