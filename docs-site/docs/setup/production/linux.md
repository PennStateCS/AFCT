# Deploy AFCT on Linux

These instructions cover **Ubuntu** and **Amazon Linux 2023**. Where the commands differ, both are listed. Other distributions can run AFCT, but the Docker installation commands will differ.

## Requirements

Review the [system requirements](../requirements.md) before starting. Git is only needed for the manual method.

On Ubuntu the guided installer can install Docker Engine and the Compose plugin for you. On Amazon Linux, install Docker and the Compose plugin first (the section below covers it) — the installer's automatic Docker setup uses Docker's convenience script, which does not support Amazon Linux.

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

Create a deployment directory and download the installer bundle:

```bash
mkdir afct
cd afct

BASE=https://raw.githubusercontent.com/PennStateCS/AFCT/main/deploy

curl -fLO "$BASE/install.sh"
curl -fLO "$BASE/docker-compose.yml"
curl -fLO "$BASE/.env.production.example"
```

Run the installer:

```bash
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

Press `Ctrl+C` to stop following the log. AFCT will continue running.

Open the public URL and confirm that the login page loads over HTTPS, the administrator can sign in, and the administration pages open.

A certificate warning is expected until you replace the default self-signed certificate.

## Manage a running deployment

The installer also serves as an operations helper. Run these from the directory that contains `docker-compose.yml`:

```bash
sh install.sh status      # container and application health
sh install.sh logs        # follow the application log (Ctrl+C to stop)
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

Continue with [HTTPS certificates](../../operations/https-certificates.md), then review [updates](../../operations/updates.md), [backups](../../operations/backups.md), and [troubleshooting](../../operations/troubleshooting.md).
