# Update AFCT

Create or confirm a current backup before applying an update.

## Guided-installer deployment

On Linux or macOS, open the directory that contains `docker-compose.yml` and run:

```bash
sh install.sh update
```

This records the currently deployed image versions, pulls the latest images, recreates the stack, and waits for the health check. If the new version does not become healthy, it automatically rolls back to the previous images and restores service.

### Update the installer itself

`sh install.sh update` uses the `docker-compose.yml` already on the host. When a release changes the compose file or the updater component, refresh those files first:

```bash
sh install.sh self-update
sh install.sh update
```

`self-update` re-downloads the installer, `docker-compose.yml`, and the environment template from the repository (backing up the old copies). It never touches `.env.production` or any data. It needs no Git checkout — the files come straight from the public repository over HTTPS.

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

## In-app updates

AFCT can upgrade and downgrade itself from **Admin → System Settings → Updates**, without a shell session. This is handled by a separate privileged helper (the *updater* sidecar) so the application container never touches Docker directly. Because that helper holds the Docker socket, it is **off by default** and must be enabled deliberately.

Enable it once, on the host, in the directory that holds `docker-compose.yml`:

```bash
sh install.sh enable-updater
```

(Or pass `--with-updater` during the initial `sh install.sh install`.) To turn it back off:

```bash
sh install.sh disable-updater
```

Once enabled, the Updates tab lists the available versions from the project's release manifest. Pick a newer version to **upgrade**: the updater takes a database backup first, swaps to the new image, waits for the health check, and rolls back automatically if the new version does not come up healthy. Each successful upgrade records a restore point for the version you left, so you can **downgrade** back to it later.

:::warning
Downgrading restores the database from the backup taken at that restore point, which **discards any data created since**. Only downgrade when you accept losing that data. The Updates tab requires an explicit confirmation before it proceeds.
:::

Only versions listed in the curated release manifest can be selected; the updater validates every request against it, so the app can never be pointed at an arbitrary image.
