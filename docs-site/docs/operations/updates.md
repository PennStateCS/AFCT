# Update AFCT

There are two ways to update: from the Updates tab in the browser, or from a terminal on the
server. Most people should use the browser. Take or confirm a backup either way.

## From the browser

This is the recommended path and it is covered in full under [In-app updates](#in-app-updates)
below. It needs no terminal, it applies stack changes for you, and it rolls back on its own if
the new version does not come up healthy.

## From a terminal on the server

On Linux and macOS the deployment is managed by `afctctl`:

```bash
sudo afctctl update
```

You can run it from any directory. It records the versions currently deployed, pulls the latest
images, recreates the stack, and waits for the health check. If the new version does not become
healthy it rolls back to the previous images by itself and puts the service back.

:::note
Older instructions said to `cd` into the folder holding `docker-compose.yml` and run
`sh install.sh update`. That still works, because `install.sh` now forwards whatever you give it
to `afctctl`. `afctctl` is the current name and needs no particular working directory.
:::

On Windows, use the PowerShell installer documented in the
[Windows guide](../setup/production/windows.md).

### Updating the deployment tool itself

`afctctl` is versioned separately from AFCT. `self-update` fetches the newest verified copy of
the deployment tooling and switches to it. It does not touch `.env.production`, your data, or
the application image:

```bash
sudo afctctl self-update
```

You rarely need to run this yourself. `update`, `restart` and `install` all check for a newer
tool first and offer it before they continue.

### Checking the result

`sudo afctctl update` already waits for the health check. To look again at any time:

```bash
sudo afctctl status
```

Every service should be running and the application should report healthy. Sign in and open an
administration page to confirm.

If something looks wrong, `sudo afctctl doctor` runs a longer read-only check, and
`sudo afctctl logs` follows the application log. See
[Troubleshooting](./troubleshooting.md).

### Running Docker commands directly

Avoid this unless you know why you need it. The stack is not in your current directory, so a
bare `docker compose ps` will find nothing. `afctctl` passes the project name, the environment
file at `/opt/afct/shared/.env.production` and the compose file at
`/opt/afct/shared/runtime/docker-compose.yml` on every call, which is why the wrapper exists.
Plain `docker compose pull` and `up -d` also skip the health check and the automatic rollback.

Named volumes hold the database, uploaded files, backups, and certificates, so they survive
whichever way the containers are replaced.

## In-app updates

AFCT can upgrade and downgrade itself from **Administration > System Settings > Updates** without a shell session. A separate privileged updater service handles the operation, so the application container never touches Docker directly. The updater holds the Docker socket and is therefore **off by default**.

Enable it once, from a terminal on the server:

```bash
sudo afctctl enable-updater
```

(Or pass `--with-updater` when you first install.) To turn it back off:

```bash
sudo afctctl disable-updater
```

Once enabled, the Updates tab lists the available versions from the project's release manifest. Pick a newer version to **upgrade**: the updater takes a database backup first, swaps to the new images, waits for the whole stack to become healthy, watches it briefly to be sure it stays healthy, and rolls back automatically if it does not. Each successful upgrade records a restore point for the version you left, so you can **downgrade** back to it later.

If that pre-upgrade backup cannot be confirmed, the upgrade goes ahead anyway and says so in the log. Rolling back to the previous images does not depend on it, which is why it is not treated as fatal. Set `UPDATER_REQUIRE_BACKUP=true` if you would rather an upgrade stop than run without one. A downgrade is stricter and refuses, for the reason given below.

:::warning
Downgrading restores the database from the backup taken at that restore point, which discards database records created since. Uploaded files are not rolled back and may become unreferenced. Only downgrade when you accept that result. The Updates tab requires explicit confirmation.
:::

Before it restores, the updater takes a fresh backup of the current state so the downgrade is itself reversible. If that safety backup cannot be confirmed, the downgrade is refused rather than run: a downgrade discards the current database, so losing the snapshot would make the current state unrecoverable. Nothing is changed when it is refused, so the app stays up. The Updates tab then offers a **Downgrade without a safety backup** action that proceeds anyway; use it only if you accept that the current state cannot be recovered afterward.

Each restore point also has a **Delete** button. Removing one deletes its backup file to reclaim disk and drops it from the list, so you can no longer downgrade to that version. It does not affect the running application.

Only versions listed in the curated release manifest can be selected; the updater validates every request against it, so the app can never be pointed at an arbitrary image. Verification fails closed: if the manifest cannot be consulted at all (the server is offline and there is no local copy), the upgrade is refused rather than run unverified, unless the deployment has explicitly opted into allowing unlisted tags. When a release also changes the stack configuration, the compose file the updater downloads is checked against a checksum recorded in the manifest before it is applied, so a corrupted or tampered download is rejected and the current configuration is kept.

Every upgrade, downgrade, and update-service change is recorded in **Administration > System Logs**: one entry when it is requested and one for the outcome (completed, rolled back, or failed), so you can review what happened after the fact even once the live progress has cleared.

### What counts as a healthy upgrade

An upgrade is only committed once the whole stack is confirmed good, not just the application container:

- **Every recreated service must be up**, and any service that defines a health check (the app, the web front, the backup sidecar) must report healthy. The web front's health check also proves it can reach the app. The evaluator worker is a background process with no health check, so "running" is enough for it; a deployment that health-checks every service can require them all with `UPDATER_REQUIRE_HEALTHCHECKS=true`.
- **A stability window** (default 45 seconds, `UPDATER_STABILITY_SECONDS`) follows: the updater keeps watching after everything is healthy, so a version that comes up and then crash-loops is caught and rolled back rather than committed. A service that exits, or the app drifting off the new version, ends the window early and rolls back.
- **Transient network failures are retried.** Downloading the images and fetching a release's manifest or compose file are retried a few times with a short backoff (`UPDATER_PULL_RETRIES`, `UPDATER_FETCH_RETRIES`), so a momentary blip does not fail an upgrade. Destructive steps (database restores, the version swap, recreating containers) are never blindly retried; those roll back instead.

### Stack changes are applied for you

Some releases change more than the application image: they add a service, a health check, or a setting in `docker-compose.yml`, or they update the updater component itself. The Updates tab handles these without a shell session:

- **Compose changes.** During an upgrade, the updater fetches that release's `docker-compose.yml` from the release's own tag, validates it, and installs it (keeping a backup) before recreating the stack. If the upgrade has to roll back, the previous compose file is restored with it. A release whose compose needs a setting your host does not provide is left in place and the upgrade proceeds on the current configuration, so a bad file can never take the stack down.
- **The updater itself.** Because the updater cannot recreate its own container, it tracks the application version separately. When it falls behind, the Updates tab shows an **Update the update service** action that brings it up to the running version. The update service restarts itself as part of this: it downloads the new version, hands off the swap, and stays in an in-flight state until the replacement update service comes back up and confirms it is actually running the new version. Only then is it reported updated. If the replacement does not come back on the expected version, that is reported rather than a false success, so a failed swap is visible instead of silently "done". A brief unavailability during the swap is expected and is not an error.

This means a terminal is normally not needed to keep a deployment current. `sudo afctctl update` remains available as a manual path, but routine upgrades, including ones that change the stack layout, can be done entirely from the Updates tab.

### "Not enough disk space"

An upgrade downloads the new images before it replaces anything, and the previous ones stay on disk until the new version is confirmed healthy, so the machine has to hold both for a while. The updater checks for room before it starts and refuses the upgrade rather than running out halfway through, which would leave the stack in a state it could not roll back from.

It wants about 12 GB free on the filesystem holding Docker's image store, and `afctctl` applies the same figure when you update from a terminal. `UPDATER_DISK_MIN_MB` and `AFCT_UPDATE_MIN_FREE_MB` change it if your deployment genuinely needs a different number, but the requirement is real rather than cautious: the application image is a large one and an upgrade briefly holds two of them.

Old images left by earlier upgrades are the usual cause. `docker image prune -af` removes anything no running container is using. Superseded images are cleaned up automatically once an upgrade is confirmed healthy, so a deployment that stays current should rarely need this, but one that has rolled back or been interrupted can collect them.

### "The update service needs restarting before it can upgrade"

A container keeps the file paths it was created with. So if a release moves the settings file or the stack file, an update service that has been running since before the move keeps looking in the old place, and it will be the correct _version_ while still being unable to perform an upgrade. It reports this itself, and the Updates tab shows the warning above along with the path it cannot find.

The fix is the same **Update the update service** action, which recreates the container on the current configuration. Upgrades will keep failing until you do, so treat the warning as blocking rather than advisory.

### Recovery after an interruption

An upgrade can be interrupted partway through: the server reboots, Docker restarts, or the updater container is recreated while it is working. The updater is built to recover from this on its own, so an interrupted upgrade does not leave the deployment in an unknown state.

While an upgrade runs, the updater keeps a small transaction record in its shared volume: the previous version, the exact local images the stack was running, whether it has changed the environment or compose files yet, and how far it has got. When it starts, it looks for an unfinished transaction and reconciles it against what Docker is actually running:

- **The new version is up and healthy.** The upgrade effectively finished before the interruption, so it is committed. The updater does not roll a healthy new version back just because it was interrupted late.
- **The new version is not confirmed healthy.** The updater returns the deployment to the previous version. It compares the running container's actual image against the requested one rather than trusting the version pinned in the environment file, so an upgrade that was interrupted right after the version was written is not mistaken for a finished one.

Rollback does not depend on the registry, the network, or the old tag still existing remotely. The previous version's images are kept on disk (superseded images are pruned only after a new version is confirmed healthy), and rollback reuses those exact local images. If the previous tag is missing, the updater re-points it at the image it recorded before the upgrade. This is why a rollback still succeeds when the machine is offline or the old release has been removed from the registry.

If both the upgrade and the rollback fail, the updater stops and reports that manual recovery is required rather than guessing. The status message and the System Logs entry name the versions involved so an administrator can restore from a restore point (see [Backups](./backups.md)). An interrupted **downgrade** is never resumed automatically, because it restores the database and re-running it could apply that restore twice; it is reported for manual recovery instead.
