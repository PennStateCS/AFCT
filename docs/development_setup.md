# AFCT Development Setup Guide

This guide covers development setup on Windows, macOS, and Linux. **Running the app in Docker is the preferred and supported way** to develop AFCT.

## Table of Contents

- [1) Prerequisites (All OS)](#1-prerequisites-all-os)
- [2) Install Docker (OS-Specific)](#2-install-docker-os-specific)
- [3) Get the Code](#3-get-the-code)
- [4) Create Development Environment File](#4-create-development-environment-file)
- [5) Start the Stack (Preferred Docker Run)](#5-start-the-stack-preferred-docker-run)
- [6) Dev Ports](#6-dev-ports)
- [7) Common Dev Commands](#7-common-dev-commands)
- [8) What Happens on Startup](#8-what-happens-on-startup)
- [9) Database Management](#9-database-management)
- [10) Troubleshooting](#10-troubleshooting)
- [Optional: Non-Docker Setup (Not Recommended)](#optional-non-docker-setup-not-recommended)
  - [Install Local Dependencies](#install-local-dependencies)
  - [Configure Environment](#configure-environment)
  - [Database Setup](#database-setup)
  - [Run the App](#run-the-app)

---

## 1) Prerequisites (All OS)

- A workstation with at least 2 CPU cores and 4GB RAM.
- `git` installed.

---

## 2) Install Docker (OS-Specific)

### Windows (recommended: Windows 11)

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

## 4) Create Development Environment File

Copy the template and update values in .env.development. Follow the instructions in the file to customize your values.

### Windows (PowerShell)

```powershell
Copy-Item .env.development.example .env.development
notepad .env.development
```

### macOS / Linux

```bash
cp .env.development.example .env.development
nano .env.development
```

## 5) Start the Stack (Preferred Docker Run)

```bash
npm run docker:dev
```

---

## 6) Dev Ports

- App (HTTP): 3000
- Prisma Studio: 5555
- Postgres: 5432
- Nginx HTTP: 8080
- Nginx HTTPS: 8443

### Nginx Forwarding and TLS

In development, Nginx listens on ports 8080 (HTTP) and 8443 (HTTPS) and forwards traffic to the app on port 3000.

Nginx uses a self-signed certificate by default. Browsers will show a security warning the first time you visit https://localhost:8443. This is expected in development; you must accept the warning to proceed.

---

## 7) Common Dev Commands

```bash
npm run docker:dev               # Build and run
npm run docker:dev:detached      # Build and run in background
npm run docker:dev:seed          # Seed the database
npm run docker:dev:migrate       # Run database migrations
npm run docker:dev:psql          # Open psql
npm run docker:dev:emptydb       # Truncate all tables
npm run docker:dev:down          # Stop containers (keep volumes)
npm run docker:dev:clean         # Stop and prune unused resources
npm run docker:dev:down:volumes  # Stop containers (remove volumes)
npm run docker:dev:resetdb       # Stop containers remove database
npm run docker:dev:nuke          # Remove containers, volumes, and data
```

---

## 8) What Happens on Startup

- PostgreSQL container starts
- Prisma migrations applied
- Seed data inserted
- Next.js dev server launched with hot reload

---

## 9) Database Management

### Prisma (Local / Node)

```bash
npm run db:generate # Generate Prisma client
npm run db:migrate  # Create and run migrations (dev)
npm run db:deploy   # Apply migrations (prod)
npm run db:studio   # Open Prisma Studio
npm run db:reset    # Reset database
npm run seed        # Seed database
```

### Inside Docker

```bash
npm run docker:dev:studio # Open Prisma Studio
npm run docker:dev:seed   # Seed the database
npm run docker:dev:psql   # Open psql
```

---

## 10) Troubleshooting

### Containers not starting

```bash
docker compose -f docker-compose.dev.yml ps
docker compose -f docker-compose.dev.yml logs -f
```

### App not reachable

- Verify nginx ports 8080/8443 are free.
- Check nginx logs:

```bash
docker compose -f docker-compose.dev.yml logs -f nginx
```

### Database

```bash
docker logs afct-dev-postgres                            # View Postgres logs
docker exec -it afct-dev-postgres pg_isready -U afct_user # Check Postgres readiness
```

### Auth / Login

```bash
docker exec -it afct-dev sh -lc 'echo $NEXTAUTH_URL'     # Verify NEXTAUTH_URL in container
docker exec -it afct-dev sh -lc 'echo $NEXTAUTH_SECRET'  # Verify NEXTAUTH_SECRET in container
docker logs afct-dev | tail                              # Tail app logs
```

### File Uploads / Permissions

```bash
docker exec -it afct-dev sh -lc 'ls -ld /private/uploads /app/public/uploads'
```

---

## Optional: Non-Docker Setup (Not Recommended)

Docker is the supported development setup. If you must run without Docker, use the steps below.

### Install Local Dependencies

- Node.js 20+
- PostgreSQL 15+
- Java 21+

Verify:

```bash
node --version
psql --version
java -version
```

### Configure Environment

Copy and edit the dev environment file:

```bash
cp .env.development.example .env.development
```

Update database connection values to point at your local PostgreSQL.

### Database Setup

Create the database and user to match your .env.development values, then run:

```bash
npm install
npm run db:generate
npm run db:migrate
npm run seed
```

### Run the App

```bash
npm run dev
```
