# AFCT Production Setup Guide

This guide covers production deployment on Windows, macOS, and Linux. **Running the app in Docker is the preferred and supported way** to deploy AFCT.

## Table of Contents

- [1) Prerequisites (All OS)](#1-prerequisites-all-os)
- [2) Install Docker (OS-Specific)](#2-install-docker-os-specific)
- [3) Get the Code](#3-get-the-code)
- [4) Create Production Environment File](#4-create-production-environment-file)
- [5) TLS Certificates (Production)](#5-tls-certificates-production)
- [6) Start the Stack (Preferred Docker Run)](#6-start-the-stack-preferred-docker-run)
- [7) Verify Deployment](#7-verify-deployment)
- [8) Updating the Application](#8-updating-the-application)
- [9) Backups](#9-backups)
- [10) Troubleshooting](#10-troubleshooting)
- [Optional: Non-Docker Setup (Not Recommended)](#optional-non-docker-setup-not-recommended)
  - [Node.js (No Docker)](#nodejs-no-docker)

---

## 1) Prerequisites (All OS)

- A server or host with at least 2 CPU cores and 4GB RAM.
- Public DNS record pointing your domain to the server’s IP.
- Open firewall ports: **80** (HTTP) and **443** (HTTPS).
- `git` installed.

> The Docker setup uses named volumes, so no host directories are required for persistence.

---

## 2) Install Docker (OS-Specific)

### Windows (recommended: Windows Server 2022 / Windows 11)

1. Install **Docker Desktop** and enable **WSL 2**:
   - https://docs.docker.com/desktop/install/windows-install/
2. During installation, ensure **Use WSL 2 instead of Hyper-V** is enabled.
3. Open PowerShell and verify:

```powershell
wsl --status
docker --version
docker compose version
```

### macOS (Apple Silicon or Intel)

1. Install **Docker Desktop**:
   - https://docs.docker.com/desktop/install/mac-install/
2. Verify:

```bash
docker --version
docker compose version
```

### Linux (Ubuntu/Debian example)

1. Install Docker Engine and Compose plugin:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

printf "%s" \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

2. Allow your user to run Docker without sudo (log out/in after):

```bash
sudo usermod -aG docker $USER
```

3. Verify:

```bash
docker --version
docker compose version
```

---

## 3) Get the Code

```bash
git clone https://github.com/pennstatewilkes-barre/afct.git
cd afct
```

---

## 4) Create Production Environment File

Copy the template and update values in .env.production.

### Windows (PowerShell)

```powershell
Copy-Item .env.production.template .env.production
notepad .env.production
```

### macOS / Linux

```bash
cp .env.production.template .env.production
nano .env.production
```

**Notes**:

- Use a long random value for NEXTAUTH_SECRET.
- NEXTAUTH_URL must match your public HTTPS domain.

---

## 5) TLS Certificates (Production)

The nginx container will generate a self-signed certificate **once** if none exist. For production you should replace it with a real certificate.

### Option A: Use your own certificate files

Copy your cert and key into the Docker volume after the first run:

```bash
# Start once to create volumes
sudo docker compose -f docker-compose.yml up -d

# Copy certs into the nginx_certs volume
sudo docker cp /path/to/fullchain.pem afct-nginx:/etc/nginx/certs/server.crt
sudo docker cp /path/to/privkey.pem afct-nginx:/etc/nginx/certs/server.key

# Restart nginx to load the certs
sudo docker compose -f docker-compose.yml restart nginx
```

### Option B: Keep self-signed certs (not recommended)

If you keep the generated certs, browsers will show warnings and users must proceed manually.

---

## 6) Start the Stack (Preferred Docker Run)

```bash
docker compose -f docker-compose.yml up -d
```

This starts:

- `afct-postgres` (database)
- `afct-app` (Next.js app)
- `afct-nginx` (reverse proxy + TLS)

---

## 7) Verify Deployment

```bash
# Check container status
docker compose ps

# Follow logs for the app
docker compose logs -f app
```

Open your domain in a browser:

```
https://your-domain.com
```

---

## 8) Updating the Application

```bash
cd afct
git pull

docker compose -f docker-compose.yml pull
docker compose -f docker-compose.yml up -d
```

---

## 9) Backups

```bash
# Database backup
docker exec afct-postgres pg_dump -U afct_user afct > backup.sql

# Restore
docker exec -i afct-postgres psql -U afct_user afct < backup.sql
```

---

## 10) Troubleshooting

### Containers not starting

```bash
docker compose ps
docker compose logs -f postgres
```

### Health check failing

```bash
docker compose logs -f app
```

### TLS warnings in browser

Make sure you installed a real certificate in the nginx certs volume and restarted nginx.

### Port 80/443 already in use

Stop the service using them or change the nginx ports in [docker-compose.yml](../docker-compose.yml).

---

## Optional: Non-Docker Setup (Not Recommended)

Docker is the supported production setup. If you must run without Docker, you will need to install Node.js, PostgreSQL, and nginx manually, mirror the environment variables in .env.production, and configure a reverse proxy. This setup is not covered here.

### Node.js (No Docker)

```bash
npm install         # Install dependencies
npm run build       # Build the app
npm run db:generate # Generate Prisma client
npm run db:deploy   # Apply migrations
npm start           # Start the production server
```

Requires:

- Node.js 20+
- PostgreSQL 15+
- Java 21+
