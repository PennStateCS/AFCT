# AFCT Development Setup Guide

This guide covers development setup on Windows, macOS, and Linux. **Running the app in Docker is the preferred and supported way** to develop AFCT. The Docker setup gives you the same PostgreSQL version, the same nginx configuration, and the same startup sequence as production, which means fewer "works on my machine" surprises. There is a non-Docker path at the bottom of this document, but it exists for the rare case where Docker is not an option, and you are on your own for most of it.

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

The RAM floor matters more than it looks: the dev stack runs PostgreSQL, nginx, and a Next.js dev server with hot reload side by side, and a machine under 4GB will thrash. Anything beyond these two items is handled inside the containers, so there is nothing else to install on the host.

---

## 2) Install Docker (OS-Specific)

You need both the Docker engine and the Compose plugin. All the `npm run docker:*` scripts in this repo call `docker compose` (the plugin, with a space), not the older standalone `docker-compose`, so make sure the version check below succeeds before moving on.

### Windows (recommended: Windows 11)

1. Install **Docker Desktop** and enable **WSL 2**:
   - https://docs.docker.com/desktop/install/windows-install/
2. During installation, ensure **Use WSL 2 instead of Hyper-V** is enabled. The WSL 2 backend performs noticeably better with the bind mounts this project uses; Hyper-V mode will work but file watching and rebuilds get slow.
3. Open PowerShell and verify:

```powershell
wsl --status
docker --version
docker compose version
```

`wsl --status` should report a default WSL 2 distribution. The two Docker commands should each print a version string. If `docker compose version` errors out, Docker Desktop did not install the Compose plugin, which usually means a very old Docker Desktop; update it.

### macOS (Apple Silicon or Intel)

1. Install **Docker Desktop**:
   - https://docs.docker.com/desktop/install/mac-install/
2. Verify:

```bash
docker --version
docker compose version
```

Both commands print a version if the install worked. If `docker --version` succeeds but later commands hang, Docker Desktop probably is not running yet; launch it and wait for the whale icon to settle.

### Linux (Ubuntu/Debian example)

On Linux you install Docker Engine directly rather than Docker Desktop. The block below adds Docker's apt repository and installs the engine plus the Compose and buildx plugins in one pass:

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

This adds you to the `docker` group. The group change does not apply to your current shell, so log out and back in (or start a new login session) before continuing. If you skip this, every `docker` command will fail with a permission error on `/var/run/docker.sock`.

3. Verify:

```bash
docker --version
docker compose version
```

---

## 3) Get the Code

```bash
git clone https://github.com/PennStateWilkes-Barre/AFCT-Dashboard.git
cd AFCT-Dashboard
```

Everything that follows assumes you are in the repository root, since the npm scripts and compose files are resolved relative to it.

---

## 4) Create Development Environment File

The app reads its development configuration from `.env.development`, which is gitignored so your local values never end up in a commit. Copy the template and update values in .env.development. Follow the instructions in the file to customize your values; the template documents each variable inline, and for a first run the defaults are enough to boot the stack.

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

After copying the file, confirm the captcha keys are present:

- `NEXT_PUBLIC_HCAPTCHA_SITE_KEY`: defaults to the hCaptcha test site key for local use.
- `HCAPTCHA_SECRET_KEY`: defaults to the hCaptcha test secret. Replace both values with real keys if you want to exercise the full challenge flow using your own hCaptcha account.

You can create new keys anytime at <https://dashboard.hcaptcha.com/sites>. Local development works with the provided test credentials, but production-style testing should use your own keys. The test keys always pass the challenge, which is convenient locally and exactly why they must never leave development.

## 5) Start the Stack (Preferred Docker Run)

```bash
npm run docker:dev
```

This builds the images if needed and brings up the whole stack (Postgres, the app, nginx) in the foreground with logs streaming to your terminal. The first run takes a few minutes because it downloads base images and installs dependencies; later runs reuse the cache and start in seconds. You will know it worked when the log settles into the Next.js dev server banner reporting that it is ready on port 3000. Leave this terminal open; Ctrl+C stops the stack. If you would rather have your terminal back, use the detached variant listed in section 7.

---

## 6) Dev Ports

- App (HTTP): 3000
- Prisma Studio: 5555
- Postgres: 5432
- Nginx HTTP: 8080
- Nginx HTTPS: 8443

Day to day you will mostly use 3000 (the app directly, with hot reload) and 5555 (Prisma Studio, a web UI for browsing the database). Port 5432 is exposed so you can point a local psql or GUI client at the containerized database if you want to.

### Nginx Forwarding and TLS

In development, Nginx listens on ports 8080 (HTTP) and 8443 (HTTPS) and forwards traffic to the app on port 3000. This mirrors the production layout, where nginx sits in front of the app, so anything that depends on proxy headers or HTTPS behaves the same in dev.

Nginx uses a self-signed certificate by default. Browsers will show a security warning the first time you visit https://localhost:8443. This is expected in development; you must accept the warning to proceed. There is no real certificate authority behind localhost, so the warning is unavoidable and harmless here.

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

A few of these deserve a word of caution. The commands in the top half are safe to run whenever: seeding, migrating, and stopping with `docker:dev:down` all preserve your data. The bottom half is destructive to varying degrees. `docker:dev:emptydb` truncates tables but keeps the schema; `docker:dev:down:volumes` and `docker:dev:resetdb` delete the database volume; `docker:dev:nuke` removes everything including uploads. Reach for the destructive ones deliberately, not as a reflexive "restart" move, because your local test data does not come back.

---

## 8) What Happens on Startup

Every time the stack comes up, it runs through the same sequence:

- PostgreSQL container starts
- Prisma migrations applied
- Seed data inserted
- Next.js dev server launched with hot reload

The app container waits for Postgres to accept connections before it runs migrations, so a slow database start just delays the sequence rather than breaking it. If startup stalls, the logs tell you which stage it died in: a Prisma error before the dev server banner means migrations failed (often a schema conflict from a branch switch), while a clean banner followed by errors in the browser points at the app itself.

---

## 9) Database Management

There are two sets of database scripts. The `db:*` scripts run Prisma on your host machine, which is mainly useful in the non-Docker setup or when you are authoring a new migration. The `docker:dev:*` scripts execute inside the running containers and are the right choice when you are developing in Docker, since they use the container's environment and network.

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

Prisma Studio opens on port 5555 and gives you a browsable, editable view of every table, which is usually faster than writing SQL for quick data checks. The psql script drops you into an interactive shell inside the Postgres container for when you do want raw SQL.

---

## 10) Troubleshooting

The general debugging order: confirm the containers are actually running, then read their logs, then check the specific subsystem (nginx, Postgres, auth, uploads). Most problems announce themselves plainly in the logs; the sections below tell you where to look and what the output means.

### Containers not starting

```bash
docker compose -f docker-compose.dev.yml ps
docker compose -f docker-compose.dev.yml logs -f
```

`ps` shows each container's state. Everything should be `Up`; a container stuck in `Restarting` is crash-looping, and `Exited` means it died and stayed down. Either way, the logs command shows why. A container that exits within seconds of starting almost always logs its fatal error in the last few lines, so scroll to the end first.

### App not reachable

- Verify nginx ports 8080/8443 are free. Another process already bound to those ports (a second copy of this stack, or an unrelated local server) prevents nginx from starting at all, and the compose logs will show a bind error.
- Check nginx logs:

```bash
docker compose -f docker-compose.dev.yml logs -f nginx
```

If nginx is up but the site returns a 502, nginx is running fine and the app behind it is not answering; switch your attention to the app container's logs instead.

### Database

```bash
docker logs afct-dev-postgres                            # View Postgres logs
docker exec -it afct-dev-postgres pg_isready -U afct_user # Check Postgres readiness
```

`pg_isready` prints `accepting connections` when the database is healthy. If it reports the server is not responding while the container shows as up, Postgres is still initializing (normal for the first minute after a fresh volume) or it crashed during startup, and its logs will say which. Database problems upstream tend to surface downstream as Prisma connection errors in the app logs, so checking readiness first saves you from chasing the wrong container.

### Auth / Login

Login failures in development are usually environment problems, not code problems. NextAuth needs both a URL that matches how you are accessing the app and a secret for signing sessions, and either one missing or wrong produces confusing redirect loops or silent sign-in failures. Confirm both are actually set inside the container, since a value in your `.env.development` does no good if it never made it into the container environment:

```bash
docker exec -it afct-dev sh -lc 'echo $NEXTAUTH_URL'     # Verify NEXTAUTH_URL in container
docker exec -it afct-dev sh -lc 'echo $NEXTAUTH_SECRET'  # Verify NEXTAUTH_SECRET in container
docker logs afct-dev | tail                              # Tail app logs
```

An empty line from either echo means the variable is unset in the container; fix `.env.development` and recreate the containers. If both look right, the app log tail will usually show the actual NextAuth error.

### File Uploads / Permissions

Uploads land in two directories inside the app container, and if their ownership or permissions are wrong the app can serve pages fine while every upload fails. Check what the container actually sees:

```bash
docker exec -it afct-dev sh -lc 'ls -ld /private/uploads /app/public/uploads'
```

Both directories should exist and be writable by the user the app runs as. A missing directory or a root-owned one explains upload errors immediately.

### "Module not found" after adding an npm dependency

`node_modules` lives in a named volume (`afct-dev-node-modules`) that is mounted
over `/app/node_modules`. That volume persists across `--build`, so rebuilding the
image does **not** pick up a newly added package: the old volume keeps shadowing
it, and you get `Module not found: Can't resolve '<pkg>'`.

This one bites everyone eventually, because the intuitive fix (rebuild the image) is exactly the thing that does not work. The image gets the new package; the volume mounted on top of it does not.

Fix it one of two ways:

```bash
# Fast: install into the running container's volume, then restart the app.
docker exec afct-dev npm install
docker exec afct-dev sh -lc 'rm -rf .next/cache'
docker restart afct-dev
```

```bash
# Or recreate just the node_modules volume (keeps the database + uploads).
npm run docker:dev:down            # stops without -v, so data is preserved
docker volume rm afct_afct-dev-node-modules
npm run docker:dev
```

The first approach is quicker and works while the stack is running. The second is the clean-slate option: with the stale volume gone, the next startup repopulates `node_modules` from scratch.

Do **not** use `docker:dev:down:volumes` or `docker:dev:nuke` for this: they pass
`-v` and also wipe Postgres data and uploads.

---

## Optional: Non-Docker Setup (Not Recommended)

Docker is the supported development setup. If you must run without Docker, use the steps below. Understand what you give up: you have to install and version-manage Node, PostgreSQL, and Java yourself, you lose the nginx proxy layer, and setup problems on this path are yours to debug.

### Install Local Dependencies

- Node.js 22+
- PostgreSQL 15+
- Java 21+

Verify:

```bash
node --version
psql --version
java -version
```

Each command should print a version at or above the minimum listed. Do not skip the Java check; parts of the app depend on it even though this is a Node project.

### Configure Environment

Copy and edit the dev environment file:

```bash
cp .env.development.example .env.development
```

Update database connection values to point at your local PostgreSQL. The template's defaults assume the Docker network, so the host, user, and password will not match your local install until you change them.

### Database Setup

Create the database and user to match your .env.development values, then run:

```bash
npm install
npm run db:generate
npm run db:migrate
npm run seed
```

This installs dependencies, generates the Prisma client, applies the schema to your database, and loads seed data. If `db:migrate` fails to connect, the connection values in `.env.development` do not match the database and user you just created; fix that before retrying.

### Run the App

```bash
npm run dev
```

The dev server starts on port 3000 with hot reload. Without Docker there is no nginx in front of it, so you access the app at http://localhost:3000 directly.
