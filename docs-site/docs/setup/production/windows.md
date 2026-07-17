# Deploy AFCT on Windows

These instructions use Docker Desktop with the WSL 2 backend.

## Requirements

Review the [system requirements](../requirements.md) before starting. On Windows you also need WSL 2 and [Docker Desktop](https://docs.docker.com/desktop/install/windows-install/); Git is only needed for the manual method.

## Configure DNS and the firewall

Set the DNS record before installation. `NEXTAUTH_URL` must exactly match the address users will visit:

```text
https://afct.example.edu
```

Do not use HTTP, an IP address, the wrong subdomain, an extra path, or an unnecessary port.

Allow inbound connections on ports 80 and 443.

## Install Docker

Install [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/) and enable **Use WSL 2 instead of Hyper-V**.

Start Docker Desktop, open PowerShell, and verify the installation:

```powershell
wsl --status
docker --version
docker compose version
docker info
```

Do not continue until WSL 2 is available and all Docker commands succeed.

## Guided installation (recommended)

:::warning Don't run the installer from a `git clone`
Download the bundle into a fresh, empty directory as shown below — do **not** run the installer from a checkout of the repository. A clone contains a developer compose file that *builds* the nginx and backup images from local folders, and the installer will fail with an error like `unable to prepare context: path ".../docker/nginx" not found`. The downloaded `docker-compose.yml` pulls the prebuilt published images instead and needs no repository checkout. (A clone is only for the [manual method](#manual-installation).)
:::

Create a deployment directory and download the installer bundle:

```powershell
New-Item -ItemType Directory -Path afct -Force | Out-Null
Set-Location afct

$base = 'https://raw.githubusercontent.com/PennStateCS/AFCT/main/deploy'

foreach ($file in 'install.ps1', 'docker-compose.yml', '.env.production.example') {
    Invoke-WebRequest "$base/$file" -OutFile $file
}
```

Run the installer:

```powershell
.\install.ps1
```

When PowerShell blocks the script, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### What the installer asks for

The installer prompts for:

- The public AFCT URL, used as `NEXTAUTH_URL`
- The initial administrator email address
- The initial administrator password, or it can generate a strong one for you

It then verifies Docker, generates the PostgreSQL password and authentication secret, writes `.env.production` with restricted permissions, shows a short review, downloads the images, and starts AFCT. A generated administrator password is printed once at the end and is never written to the log, so save it before closing the terminal.

Re-running `.\install.ps1` on a configured host detects the existing installation and offers a menu: start or repair it, update it, reconfigure the public URL or bootstrap settings, run system checks, or create a diagnostics archive. Existing database and authentication secrets are preserved during reconfiguration.

For unattended installs, supply the values as environment variables and pass `-NonInteractive`. Docker Desktop must already be installed and running:

```powershell
$env:ADMIN_EMAIL = 'admin@example.edu'
$env:ADMIN_PASSWORD_FILE = 'C:\secrets\afct-admin-password.txt'
$env:APP_URL = 'https://afct.example.edu'
.\install.ps1 -NonInteractive
```

### Installer diagnostics

A failed installation creates a redacted archive in the installation directory:

```text
afct-diagnostics-<timestamp>.zip
```

Create one manually with:

```powershell
.\install.ps1 diagnostics
```

Review the archive before sharing it.

## Manual installation

Most deployments should use the guided installer above. Use the manual method only when you need to customize the Compose configuration, automate provisioning, or manage the repository directly with Git.

Clone the repository and create the environment file:

```powershell
git clone https://github.com/PennStateCS/AFCT.git
Set-Location .\AFCT
Copy-Item .env.production.example .env.production
notepad .env.production
```

Configure these required values:

- `POSTGRES_PASSWORD`: Use a long random password. The same password must appear in `DATABASE_URL`.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD`: These seed the first administrator only when the database is empty.
- `NEXTAUTH_URL`: Use the exact public HTTPS address.

Generate `NEXTAUTH_SECRET` in PowerShell:

```powershell
$bytes = New-Object byte[] 64
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

Copy the generated value into `.env.production`. Changing the secret later signs every user out.

hCaptcha is optional. You can set `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` and `HCAPTCHA_SECRET_KEY` now, or configure hCaptcha later in **System Settings > Security > hCaptcha**. Do not use hCaptcha test credentials in production.

Limit access to `.env.production`. Do not commit it, attach it to support requests, place it in a public folder, or send it through unencrypted email.

Start AFCT:

```powershell
docker compose up -d
```

## Verify the installation

Check the services:

```powershell
docker compose ps
```

All four services should be `Up`. The application should eventually report `healthy`.

Review the application log:

```powershell
docker compose logs -f app
```

Press `Ctrl+C` to stop following the log. AFCT will continue running.

Open the public URL and confirm that the login page loads over HTTPS, the administrator can sign in, and the administration pages open.

A certificate warning is expected until you replace the default self-signed certificate.

## Manage a running deployment

The installer also serves as an operations helper. Run these from the directory that contains `docker-compose.yml`:

```powershell
.\install.ps1 status      # container and application health
.\install.ps1 logs        # follow the application log (Ctrl+C to stop)
.\install.ps1 doctor      # read-only system and configuration checks
.\install.ps1 update      # pull the latest images, recreate, and verify health
.\install.ps1 restart     # recreate the stack without pulling images
.\install.ps1 stop        # stop the stack without deleting data volumes
.\install.ps1 diagnostics # create a redacted support archive
```

`.\install.ps1 update` records the running image versions before pulling and automatically rolls back if the new version fails its health check.

### In-app upgrades (optional)

To run upgrades and downgrades from **Admin → System Settings → Updates** instead of the command line, enable the updater sidecar:

```powershell
.\install.ps1 enable-updater    # .\install.ps1 disable-updater to turn it off
```

A fresh interactive install also offers to enable it at the end; to opt in
non-interactively, pass `-WithUpdater` (equivalent to running `enable-updater`
afterward):

```powershell
.\install.ps1 -WithUpdater
```

This is **off by default** because the updater holds the Docker socket (root-equivalent on the host). Once enabled, `update`, `restart`, and `status` include it automatically. Downgrades restore a pre-upgrade database backup and **permanently discard everything created since it**, so treat them as recovery, not a casual undo.

Continue with [HTTPS certificates](../../operations/https-certificates.md), then review [updates](../../reference/updates.md), [backups](../../operations/backups.md), and [troubleshooting](../../operations/troubleshooting.md).
