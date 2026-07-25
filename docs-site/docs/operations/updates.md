# Update AFCT

Create or confirm a current backup before applying an update.

## Guided-installer deployment

On Linux or macOS, open the directory that contains `docker-compose.yml` and run:

```bash
sh install.sh update
```

This records the currently deployed image versions, pulls the latest images, recreates the stack, and waits for the health check. If the new version does not become healthy, it automatically rolls back to the previous images and restores service.

### Update the installer itself

`sh install.sh update` uses the `docker-compose.yml` already on the host. Use `self-update` when you want to refresh the installer script itself:

```bash
sh install.sh self-update
sh install.sh update
```

`self-update` downloads the installer, `docker-compose.yml`, and the environment template from the repository, backing up the old copies first. It never touches `.env.production` or application data. It needs no Git checkout because the files come from the public repository over HTTPS.

A changed `docker-compose.yml` no longer has to be refreshed by hand before an update: an in-app upgrade applies the target release's compose file for you (see [In-app updates](#in-app-updates) below). This host-side path stays available for deployments that do not run the updater, or as a fallback.

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

AFCT can upgrade and downgrade itself from **Admin Menu > System Settings > Updates** without a shell session. A separate privileged updater service handles the operation, so the application container never touches Docker directly. The updater holds the Docker socket and is therefore **off by default**.

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
Downgrading restores the database from the backup taken at that restore point, which discards database records created since. Uploaded files are not rolled back and may become unreferenced. Only downgrade when you accept that result. The Updates tab requires explicit confirmation.
:::

Each restore point also has a **Delete** button. Removing one deletes its backup file to reclaim disk and drops it from the list, so you can no longer downgrade to that version. It does not affect the running application.

Only versions listed in the curated release manifest can be selected; the updater validates every request against it, so the app can never be pointed at an arbitrary image.

Every upgrade, downgrade, and update-service change is recorded in **Admin Menu > System Settings > System Logs**: one entry when it is requested and one for the outcome (completed, rolled back, or failed), so you can review what happened after the fact even once the live progress has cleared.

### Stack changes are applied for you

Some releases change more than the application image: they add a service, a health check, or a setting in `docker-compose.yml`, or they update the updater component itself. The Updates tab handles these without a shell session:

- **Compose changes.** During an upgrade, the updater fetches that release's `docker-compose.yml` from the release's own tag, validates it, and installs it (keeping a backup) before recreating the stack. If the upgrade has to roll back, the previous compose file is restored with it. A release whose compose needs a setting your host does not provide is left in place and the upgrade proceeds on the current configuration, so a bad file can never take the stack down.
- **The updater itself.** Because the updater cannot recreate its own container, it tracks the application version separately. When it falls behind, the Updates tab shows an **Update the update service** action that brings it up to the running version. The update service restarts itself as part of this, so the tab reports progress and confirms once it comes back on the new version; a brief unavailability during the swap is expected and is not an error.

This means the console is normally not needed to keep a deployment current. The host-side `sh install.sh self-update` remains available as a manual path and as the way to update the installer script, but routine upgrades, including ones that change the stack layout, can be done entirely from the Updates tab.
