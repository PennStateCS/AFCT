# AFCT on Linux

These instructions cover **Ubuntu** and **Amazon Linux 2023**. Where the commands differ, both are listed. Other distributions can run AFCT, but the Docker installation commands will differ.

## Requirements

Review the [system requirements](../requirements.md) before starting. Git is only needed for the manual method.

On Ubuntu the guided installer can install Docker Engine and the Compose plugin for you. On Amazon Linux, install Docker and the Compose plugin first. The section below covers it. The installer's automatic Docker setup uses Docker's convenience script, which does not support Amazon Linux.

## Configure DNS and the firewall

Set the DNS record before installation. `NEXTAUTH_URL` must exactly match the address users will visit:

```text
https://afct.example.edu
```

Do not use HTTP, an IP address, the wrong subdomain, an extra path, or an unnecessary port.

Keep port 80 open. nginx uses it to redirect HTTP requests to HTTPS on port 443.

## Install Docker

### Ubuntu

Install Docker Engine and the Compose plugin from Docker's official repository:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git
sudo install -m 0755 -d /etc/apt/keyrings

curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### Amazon Linux 2023

Docker is in the Amazon Linux repositories, but the Compose plugin is not, so it is installed from Docker's GitHub releases:

```bash
sudo dnf install -y docker git
sudo systemctl enable --now docker

sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -fSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
```

The `$(uname -m)` picks the right binary for both x86 and Graviton (ARM) instances.

### Both distributions

Allow your account to use Docker without `sudo`:

```bash
sudo usermod -aG docker "$USER"
```

Log out and sign in again, then verify the installation:

```bash
docker --version
docker compose version
docker info
```

Do not continue until all three commands succeed.

## Guided installation (recommended)

Download the bootstrap installer and run it. It is a small script that fetches a
signed, versioned deployment bundle from the latest GitHub release, verifies its
checksum before running anything, and installs AFCT under `/opt/afct`:

```bash
curl -fsSLO https://github.com/PennStateCS/AFCT/releases/latest/download/install.sh
sudo sh install.sh
```

`wget https://github.com/PennStateCS/AFCT/releases/latest/download/install.sh` works
too. Nothing is cloned and no authentication is needed; the bundle and its `.sha256`
come from the public release assets over HTTPS.

After installation, all operations run through the `afctctl` command, which the
installer places on your `PATH`. You do not keep a copy of `install.sh` around or run
it again for day-to-day tasks. See [Manage a running deployment](#manage-a-running-deployment).

### Where AFCT is installed

The bootstrap installs into a versioned layout so the tooling can be updated and rolled
back without touching your configuration or data:

```text
/opt/afct/
  bin/afctctl                # symlink to the active release's afctctl
  current -> releases/<ver>  # the active deployment-tool release
  releases/<ver>/            # bundle contents: afctctl, libraries, docker-compose.yml
  shared/                    # persistent, never replaced by an update
    .env.production          # your configuration and secrets
    install.log
    backups/
```

Your `.env.production`, backups, and logs live in `shared/` and are never inside a
release directory, so updating the tooling cannot overwrite them. At least one previous
release is kept for rollback.

:::note Installing from a fork or mirror
To install from a fork or an internal mirror, point the bootstrap at your own release
assets before running it: set `AFCT_RELEASE_API` to the fork's releases API, or
`AFCT_BUNDLE_URL` / `AFCT_BUNDLE_FILE` to a specific bundle. The default is the official
`PennStateCS/AFCT` release assets.
:::

### What the installer asks for

The installer prompts for:

- The public AFCT URL, used as `NEXTAUTH_URL`
- The initial administrator email address
- The initial administrator password, or it can generate a strong one for you

It then verifies Docker, generates the PostgreSQL password and authentication secret, writes `.env.production` with restricted permissions, shows a short review, downloads the images, and starts AFCT. A generated administrator password is printed once at the end and is never written to the log, so save it before closing the terminal.

Running `afctctl install` again on a configured host detects the existing installation and offers a menu: start or repair it, update it, reconfigure the public URL or bootstrap settings, run system checks, or create a diagnostics archive. Existing database and authentication secrets are preserved during reconfiguration.

:::note Upgrading from an earlier release
If you previously installed AFCT by downloading `install.sh` and the Compose file into a
directory of your own, the bootstrap migrates that directory into `/opt/afct` in place.
It preserves your `.env.production`, backups, and log, and reuses the existing Docker
volumes and Compose project so your database is not disturbed. Your old `sh install.sh <command>`
habit keeps working: that file is now a thin shim that forwards to `afctctl`.
:::

### Dedicated service account

A root install (`sudo sh install.sh`) runs AFCT under a dedicated `afct` system account rather than your login. The deploy files and the Docker-socket access then belong to a purpose-built user that is not tied to any one administrator, which is the recommended setup for a shared or long-lived server. AFCT is installed under `/opt/afct` in all cases; `afctctl` is on your `PATH`, so you can run it from anywhere:

```bash
sudo afctctl status
sudo afctctl update
```

To install as the current user instead, pass `--no-service-user`, or set `AFCT_SERVICE_USER=` (empty). To use a different account name, pass `--service-user NAME`. Installs that are not run as root always use the current user.

For unattended installs, supply the values as environment variables and pass `--non-interactive`. Docker and the Compose plugin must already be installed:

```bash
ADMIN_EMAIL=admin@example.edu \
ADMIN_PASSWORD_FILE=/run/secrets/afct-admin-password \
APP_URL=https://afct.example.edu \
  sudo sh install.sh --non-interactive
```

### Installer diagnostics

A failed installation creates a redacted archive under `/opt/afct/shared`:

```text
afct-diagnostics-<timestamp>.zip
```

Create one manually with:

```bash
sudo afctctl diagnostics
```

Review the archive before sharing it.

## Manual installation

Most deployments should use the guided installer above. Use the manual method only when you need to customize the Compose configuration, automate provisioning, or manage the repository directly with Git.

Clone the repository and create the environment file:

```bash
git clone https://github.com/PennStateCS/AFCT.git
cd AFCT
cp .env.production.example .env.production
nano .env.production
```

Configure these required values:

- `POSTGRES_PASSWORD`: Use a long random password. The same password must appear in `DATABASE_URL`.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD`: These seed the first administrator only when the database is empty.
- `NEXTAUTH_SECRET`: Generate it once with `openssl rand -base64 64`. Changing it later signs every user out.
- `NEXTAUTH_URL`: Use the exact public HTTPS address.

hCaptcha is optional. You can set `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` and `HCAPTCHA_SECRET_KEY` now, or configure it later in **Admin Menu > System Settings > Captcha**. Do not use hCaptcha test credentials in production.

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

Press `Ctrl+C` to stop following the log. AFCT will continue running.

Open the public URL and confirm that the login page loads over HTTPS, the administrator can sign in, and the administration pages open.

A certificate warning is expected until you replace the default self-signed certificate.

## Manage a running deployment

`afctctl` is the operations helper. It can be run from any directory:

```bash
sudo afctctl status      # container and application health
sudo afctctl logs        # follow the application log (Ctrl+C to stop)
sudo afctctl doctor      # read-only system and configuration checks
sudo afctctl update      # pull the latest app images, recreate, and verify health
sudo afctctl restart     # recreate the stack without pulling images
sudo afctctl stop        # stop the stack without deleting data volumes
sudo afctctl diagnostics # create a redacted support archive
sudo afctctl self-update # update the deployment tooling itself (see below)
```

`afctctl update` records the running image versions before pulling and automatically rolls back if the new version fails its health check.

### Two kinds of version

The **application** and the **deployment tooling** version independently:

- `afctctl update` moves the running AFCT **application** to a newer image.
- `afctctl self-update` updates the **`afctctl` tooling itself** to a newer bundle. It
  downloads the newest bundle, verifies its checksum, syntax-checks it, switches the
  `current` release atomically, and keeps the previous release so it can roll back if the
  new one fails to run. It does not pull application images or touch your database.

`afctctl version` prints the tooling version. The application version is shown by
`afctctl status` and in **Admin Menu > System Settings**.

### In-app upgrades (optional)

To run upgrades and downgrades from **Admin Menu > System Settings > Updates** instead of the command line, enable the updater sidecar:

```bash
sudo afctctl enable-updater    # sudo afctctl disable-updater to turn it off
```

A fresh interactive install also offers to enable it at the end; to opt in
non-interactively, pass `--with-updater` on the install:

```bash
sudo sh install.sh --with-updater
```

This is **off by default** because the updater holds the Docker socket, which is effectively root access on the host. Once enabled, `update`, `restart`, and `status` include it automatically. A downgrade restores a pre-upgrade database backup and permanently discards database records created since it. Uploaded files are left in place and can become unreferenced. Treat downgrade as recovery, not a casual undo.

Continue with [TLS certificates](../../admin/system-settings.md#tls-certificate), then review [updates](../../operations/updates.md), [backups](../../operations/backups.md), and [troubleshooting](../../operations/troubleshooting.md).
