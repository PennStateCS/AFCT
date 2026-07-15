# Deploy AFCT on macOS

These instructions work on Apple Silicon and Intel Macs. A continuously available Linux server is usually a better choice for a long-running public deployment, but macOS is supported through Docker Desktop.

## Requirements

Prepare a Mac with:

- At least 2 CPU cores
- At least 6 GB of RAM
- A public DNS record pointing to the Mac
- Inbound access on ports 80 and 443
- Docker Desktop
- Git, when using the manual method

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

## Option 1: Guided installation

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

The installer requests:

- The initial administrator email address
- The initial administrator password
- The public AFCT URL

It then verifies Docker, generates the PostgreSQL password and authentication secret, creates `.env.production`, restricts the file permissions, downloads the images, and starts AFCT.

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

## Option 2: Manual installation

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

A certificate warning is expected until you replace the default self-signed certificate. Continue with [TLS and HTTPS](../../operations/tls.md).
