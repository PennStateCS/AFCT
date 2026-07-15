# Deploy AFCT on Windows

These instructions use Docker Desktop with the WSL 2 backend.

## Requirements

Prepare a Windows computer with:

- At least 2 CPU cores
- At least 6 GB of RAM
- A public DNS record pointing to the computer
- Inbound access on ports 80 and 443
- WSL 2
- Docker Desktop
- Git, when using the manual method

Docker Desktop, Windows, PostgreSQL, nginx, and the backup service all need memory in addition to the AFCT application.

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

## Option 1: Guided installation

### Public repository

Create a deployment directory and download the installer bundle:

```powershell
New-Item -ItemType Directory -Path afct -Force | Out-Null
Set-Location afct

$base = 'https://raw.githubusercontent.com/PennStateWilkes-Barre/AFCT-Dashboard/main/deploy'

foreach ($file in 'install.ps1', 'docker-compose.yml', '.env.production.example') {
    Invoke-WebRequest "$base/$file" -OutFile $file
}
```

Run the installer:

```powershell
.\install.ps1
```

### Private repository

Authenticate with GitHub Container Registry, clone the repository, and run the installer:

```powershell
docker login ghcr.io
git clone https://github.com/PennStateWilkes-Barre/AFCT-Dashboard.git
Set-Location .\AFCT-Dashboard\deploy
.\install.ps1
```

When PowerShell blocks the script, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### What the installer asks for

The installer requests:

- The initial administrator email address
- The initial administrator password
- The public AFCT URL

It then verifies Docker, generates the PostgreSQL password and authentication secret, creates `.env.production`, downloads the images, and starts AFCT.

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

## Option 2: Manual installation

Clone the repository and create the environment file:

```powershell
git clone https://github.com/PennStateWilkes-Barre/AFCT-Dashboard.git
Set-Location .\AFCT-Dashboard
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

A certificate warning is expected until you replace the default self-signed certificate. Continue with [TLS and HTTPS](../../operations/tls.md).
