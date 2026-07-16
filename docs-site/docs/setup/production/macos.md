# Deploy AFCT on macOS

These instructions work on Apple Silicon and Intel Macs. A continuously available Linux server is usually a better choice for a long-running public deployment, but macOS is supported through Docker Desktop.

## Requirements

Review the [system requirements](../requirements.md) before starting. On macOS you also need [Docker Desktop](https://docs.docker.com/desktop/install/mac-install/); Git is only needed for the manual method.

## Configure DNS and the network

Set the DNS record before installation. `NEXTAUTH_URL` must exactly match the address users will visit:

```text
https://afct.example.edu
```

Do not use HTTP, an IP address, the wrong subdomain, an extra path, or an unnecessary port.

Allow inbound traffic on ports 80 and 443.

## Install Docker

Install [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/) for the Mac's processor.

Open Docker Desktop and enable **Start Docker Desktop when you log in**. AFCT can restart after a reboot only after Docker Desktop starts.

Verify the installation:

```bash
docker --version
docker compose version
docker info
```

Do not continue until all three commands succeed.

## Guided installation (recommended)

### Public repository

Create a deployment directory and download the installer bundle:

```bash
mkdir afct
cd afct

BASE=https://raw.githubusercontent.com/PennStateWilkes-Barre/AFCT-Dashboard/main/deploy

curl -fLO "$BASE/install.sh"
curl -fLO "$BASE/docker-compose.yml"
curl -fLO "$BASE/.env.production.example"
```

Run the installer:

```bash
sh install.sh
```

### Private repository

Authenticate with GitHub Container Registry, clone the repository, and run the installer:

```bash
docker login ghcr.io
git clone https://github.com/PennStateWilkes-Barre/AFCT-Dashboard.git
cd AFCT-Dashboard/deploy
sh install.sh
```

### What the installer asks for

The installer prompts for:

- The public AFCT URL, used as `NEXTAUTH_URL`
- The initial administrator email address
- The initial administrator password, or it can generate a strong one for you

It then verifies Docker, generates the PostgreSQL password and authentication secret, writes `.env.production` with restricted permissions, shows a short review, downloads the images, and starts AFCT. A generated administrator password is printed once at the end and is never written to the log, so save it before closing the terminal.

Re-running `sh install.sh` on a configured host detects the existing installation and offers a menu: start or repair it, update it, reconfigure the public URL or bootstrap settings, run system checks, or create a diagnostics archive. Existing database and authentication secrets are preserved during reconfiguration.

For unattended installs, supply the values as environment variables and pass `--non-interactive`. Docker and the Compose plugin must already be installed:

```bash
ADMIN_EMAIL=admin@example.edu \
ADMIN_PASSWORD_FILE=/run/secrets/afct-admin-password \
APP_URL=https://afct.example.edu \
  sh install.sh --non-interactive
```

### Installer diagnostics

A failed installation creates a redacted archive in the installation directory:

```text
afct-diagnostics-<timestamp>.zip
```

Create one manually with:

```bash
sh install.sh diagnostics
```

Review the archive before sharing it.

## Manual installation

Most deployments should use the guided installer above. Use the manual method only when you need to customize the Compose configuration, automate provisioning, or manage the repository directly with Git.

Clone the repository and create the environment file:

```bash
git clone https://github.com/PennStateWilkes-Barre/AFCT-Dashboard.git
cd AFCT-Dashboard
cp .env.production.example .env.production
nano .env.production
```

You can also use TextEdit:

```bash
open -e .env.production
```

Configure these required values:

- `POSTGRES_PASSWORD`: Use a long random password. The same password must appear in `DATABASE_URL`.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD`: These seed the first administrator only when the database is empty.
- `NEXTAUTH_SECRET`: Generate it once with `openssl rand -base64 64`. Changing it later signs every user out.
- `NEXTAUTH_URL`: Use the exact public HTTPS address.

hCaptcha is optional. You can set `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` and `HCAPTCHA_SECRET_KEY` now, or configure hCaptcha later in **System Settings > Security > hCaptcha**. Do not use hCaptcha test credentials in production.

Protect the environment file:

```bash
chmod 600 .env.production
```

Start AFCT:

```bash
docker compose up -d
```

## Verify the installation

Check the services:

```bash
docker compose ps
```

All four services should be `Up`. The application should eventually report `healthy`.

Review the application log:

```bash
docker compose logs -f app
```

Press `Control+C` to stop following the log. AFCT will continue running.

Open the public URL and confirm that the login page loads over HTTPS, the administrator can sign in, and the administration pages open.

A certificate warning is expected until you replace the default self-signed certificate.

## Manage a running deployment

The installer also serves as an operations helper. Run these from the directory that contains `docker-compose.yml`:

```bash
sh install.sh status      # container and application health
sh install.sh logs        # follow the application log (Control+C to stop)
sh install.sh doctor      # read-only system and configuration checks
sh install.sh update      # pull the latest images, recreate, and verify health
sh install.sh restart     # recreate the stack without pulling images
sh install.sh stop        # stop the stack without deleting data volumes
sh install.sh diagnostics # create a redacted support archive
```

`sh install.sh update` records the running image versions before pulling and automatically rolls back if the new version fails its health check.

### In-app upgrades (optional)

To run upgrades and downgrades from **Admin → System Settings → Updates** instead of the command line, enable the updater sidecar:

```bash
sh install.sh enable-updater    # sh install.sh disable-updater to turn it off
```

A fresh interactive install also offers to enable it at the end; to opt in
non-interactively, pass `--with-updater` (equivalent to running `enable-updater`
afterward):

```bash
sh install.sh --with-updater
```

This is **off by default** because the updater holds the Docker socket (root-equivalent on the host). Once enabled, `update`, `restart`, and `status` include it automatically. Downgrades restore a pre-upgrade database backup and **permanently discard everything created since it**, so treat them as recovery, not a casual undo.

Continue with [TLS and HTTPS](../../operations/tls.md), then review [updates](../../operations/updates.md), [backups](../../operations/backups.md), and [troubleshooting](../../operations/troubleshooting.md).
