# Development setup

Docker is the supported way to develop AFCT. It provides the expected PostgreSQL version, nginx proxy, startup order, and container environment.

A non-Docker option is included at the end for cases where Docker is unavailable.

## Requirements

- At least 2 CPU cores
- At least 4 GB of RAM
- Git
- Docker Engine with the Compose plugin

The development stack runs PostgreSQL, nginx, the Next.js development server, the backup service, and Prisma Studio.

## Install Docker

### Windows

Install [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/) and use the WSL 2 backend.

Verify in PowerShell:

```powershell
wsl --status
docker --version
docker compose version
docker info
```

### macOS

Install [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/).

Verify in Terminal:

```bash
docker --version
docker compose version
docker info
```

### Ubuntu or Debian-based Linux

Install Docker Engine and the Compose plugin:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings

curl -fsSL https://download.docker.com/linux/ubuntu/gpg |   sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

sudo chmod a+r /etc/apt/keyrings/docker.gpg

printf "%s"   "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg]   https://download.docker.com/linux/ubuntu   $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |   sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io   docker-buildx-plugin docker-compose-plugin
```

Allow the current user to run Docker:

```bash
sudo usermod -aG docker "$USER"
```

Log out and sign in again, then verify:

```bash
docker --version
docker compose version
docker info
```

## Clone the repository

```bash
git clone https://github.com/PennStateCS/AFCT.git
cd AFCT
```

All remaining commands assume the repository root.

## Create the development environment

### Windows PowerShell

```powershell
Copy-Item .env.development.example .env.development
notepad .env.development
```

### Linux or macOS

```bash
cp .env.development.example .env.development
nano .env.development
```

The example file documents each variable. Its default hCaptcha test keys are suitable for local development only.

Use your own hCaptcha keys when testing the real challenge flow. Never move the test credentials into production.

## Start AFCT

```bash
npm run docker:dev
```

The command builds and starts the stack in the foreground. Logs remain attached to the terminal. Press `Ctrl+C` to stop it.

For a detached stack:

```bash
npm run docker:dev:detached
```

## Development addresses

| Service | Address or port |
|---|---|
| Next.js application | `http://localhost:3000` |
| Prisma Studio | `http://localhost:5555` |
| PostgreSQL | Port `5432` |
| nginx HTTP | `http://localhost:8080` |
| nginx HTTPS | `https://localhost:8443` |

nginx uses a self-signed certificate in development. The browser warning at `https://localhost:8443` is expected.

Use port 3000 for normal development with hot reload. Use the nginx ports when testing proxy headers, redirects, or HTTPS behavior.

## Common commands

```bash
npm run docker:dev
npm run docker:dev:detached
npm run docker:dev:seed
npm run docker:dev:migrate
npm run docker:dev:migrate:deploy
npm run docker:dev:generate
npm run docker:dev:studio
npm run docker:dev:psql
npm run docker:dev:emptydb
npm run docker:dev:down
npm run docker:dev:clean
npm run docker:dev:down:volumes
npm run docker:dev:resetdb
npm run docker:dev:nuke
```

### Data impact

| Command | Effect |
|---|---|
| `docker:dev:down` | Stops containers and keeps volumes |
| `docker:dev:clean` | Stops the stack and prunes unused Docker resources |
| `docker:dev:emptydb` | Removes table data but keeps the schema |
| `docker:dev:down:volumes` | Removes development volumes |
| `docker:dev:resetdb` | Removes the development database |
| `docker:dev:nuke` | Removes containers, volumes, database data, and uploads |

Read destructive commands before running them. Local seed data and uploads may not be recoverable.

## Startup sequence

The stack starts in this order:

1. PostgreSQL starts.
2. The application waits for PostgreSQL.
3. Prisma migrations are applied.
4. Seed data is inserted.
5. The Next.js development server starts.
6. nginx, the backup service, and Prisma Studio become available.

A Prisma error before the Next.js ready message usually indicates a database or migration problem.

## Database work

### Host commands

Use these when running Prisma from the host or creating a migration:

```bash
npm run db:generate
npm run db:migrate
npm run db:deploy
npm run db:studio
npm run db:reset
npm run seed
```

### Docker commands

Use these for the normal containerized workflow:

```bash
npm run docker:dev:migrate
npm run docker:dev:migrate:deploy
npm run docker:dev:generate
npm run docker:dev:seed
npm run docker:dev:studio
npm run docker:dev:psql
```

Prisma Studio opens on port 5555. The psql command opens a PostgreSQL shell inside the development stack.

## Troubleshooting

See [Development troubleshooting](../../docs-site/docs/reference/development-troubleshooting.md) for container, database, sign-in, upload, and stale dependency problems.

## Optional non-Docker setup

This path is not officially supported. You are responsible for matching the versions and services normally provided by Docker.

Install:

- Node.js 22 or later
- PostgreSQL 15 or later
- Java 21 or later

Verify:

```bash
node --version
psql --version
java -version
```

Copy `.env.development.example` to `.env.development` and update the database connection for the local PostgreSQL instance.

Then run:

```bash
npm install
npm run db:generate
npm run db:migrate
npm run seed
npm run dev
```

The application starts at `http://localhost:3000`. This setup does not include the development nginx proxy.
