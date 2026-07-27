# AFCT on macOS

This macOS installer is intended for **testing, evaluation, and development**. For a
long-running production deployment, use the [Linux installer](./linux.md) on a Linux
server. Linux is the recommended production platform.

macOS runs AFCT through Docker Desktop, as your own user account. No `sudo` is required.
Apple Silicon and Intel Macs are both supported.

## Requirements

1. A current version of macOS on Apple Silicon or an Intel Mac.
2. [Docker Desktop](https://www.docker.com/products/docker-desktop/), installed and
   running. Install it with Homebrew:

   ```bash
   brew install --cask docker
   ```

   or download it from the Docker website. Then open Docker Desktop and wait until it
   reports that Docker is running.
3. Give Docker Desktop enough resources for the AFCT images (Docker Desktop settings,
   Resources): several GB of memory and disk. `afctctl doctor` warns if free disk looks
   low.

Verify Docker before you start:

```bash
docker compose version
docker info
```

Both must succeed. If `docker info` fails, Docker Desktop is not running yet.

## Install

Download and run the macOS installer:

```bash
curl -fsSLO https://github.com/PennStateCS/AFCT/releases/latest/download/install-macos.sh
sh install-macos.sh
```

The installer verifies the downloaded bundle's checksum, installs the tooling under
`$HOME/.afct`, adds an `afctctl` command to `$HOME/.local/bin`, then guides you through
configuration and starts AFCT.

If `$HOME/.local/bin` is not on your `PATH`, the installer prints how to add it. You can
always run the command directly at `$HOME/.afct/current/bin/afctctl`.

### What the installer asks for

- **The public URL.** For local testing use the default `https://localhost`. It works
  only from a browser on this same Mac. To reach AFCT from another device, use this Mac's
  LAN hostname or IP address instead (for example `https://192.168.1.20`).
- **The initial administrator email.**
- **The initial administrator password**, or let it generate a strong one. A generated
  password is printed once at the end and never written to the log, so save it.

### About the certificate

AFCT starts with a self-signed certificate. The connection is still encrypted; the
browser warning appears only because the certificate's identity is not signed by a
trusted authority. For a local test, accept the warning and continue.

Let's Encrypt generally requires a publicly reachable domain, so it is not usually
appropriate for a `localhost`-only test. A domain is optional for local testing.

## Manage a running deployment

Run these from anywhere (no `sudo`):

```bash
afctctl status      # container and application health
afctctl logs        # follow the application log (Control+C to stop)
afctctl doctor      # read-only system and configuration checks
afctctl update      # pull the latest images, recreate, and verify health
afctctl restart     # recreate the stack without pulling images
afctctl stop        # stop the stack without deleting data volumes
afctctl diagnostics # create a redacted support archive
afctctl self-update # update the deployment tooling itself
```

`afctctl update` records the running image versions before pulling and rolls back
automatically if the new version fails its health check.

### In-app updates (optional)

To run upgrades from **Admin Menu > System Settings > Updates** instead of the command
line, enable the updater sidecar:

```bash
afctctl enable-updater     # afctctl disable-updater to turn it off
```

It is off by default because the updater holds Docker Desktop's Docker socket, which is
powerful access to your Docker environment. Treat a downgrade as recovery, not a casual
undo.

## Where AFCT stores its files

```text
$HOME/.afct/
  current -> releases/<version>-<digest>   # the active deployment tooling
  releases/                                # immutable tooling releases (for rollback)
  shared/
    .env.production                        # configuration and secrets (mode 0600)
    deploy.state                           # Compose project name, runtime state
    install.log
    runtime/docker-compose.yml
```

The database and uploaded files live in Docker Desktop **named volumes**, not in this
directory.

## Update

```bash
afctctl update
```

## Uninstall

The uninstall command preserves your data by default:

```bash
afctctl uninstall
```

It stops and removes the AFCT containers, removes the `afctctl` command and the
`$HOME/.afct` directory, and leaves the database and uploaded files (Docker volumes) in
place. It asks before deleting anything irreversible; answer yes to the volume prompt
only if you want to delete the database and uploads permanently.

Application images stay in Docker Desktop. Remove them yourself if you want the space
back:

```bash
docker image ls | grep afct
```
