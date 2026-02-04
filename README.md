# AFCT Dashboard

A modern Next.js 15 dashboard for the Automated Feedback for CS Theory (AFCT) system.  
Built with:

![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)
![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-ORM-blue?logo=prisma)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38B2AC?logo=tailwindcss&logoColor=white)
![Auth.js](https://img.shields.io/badge/Auth.js-NextAuth%20v5-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript)
[![Publish Docker image to GHCR](https://github.com/PennStateWilkes-Barre/AFCT-Dashboard/actions/workflows/publish-ghcr.yml/badge.svg?branch=main)](https://github.com/PennStateWilkes-Barre/AFCT-Dashboard/actions/workflows/publish-ghcr.yml)

## Table of Contents

- [Tech Stack](#-tech-stack)
- [Docker Development (Recommended)](#-docker-development-recommended)
- [Production (Docker)](#-production-docker)
- [Nginx (Production Port Forwarding)](#-nginx-production-port-forwarding)
- [Production (Node.js – No Docker)](#-production-nodejs--no-docker)
- [Database Management](#-database-management)
- [Troubleshooting](#-troubleshooting)
- [Contributors](#-contributors)

## 📚 Tech Stack

- Node.js 20+
- Next.js 15
- PostgreSQL + Prisma
- Auth.js / NextAuth v5
- Tailwind CSS
- Docker + GHCR

## 🐳 Docker Development (Recommended)

### Ports

- **App (HTTP)**: localhost:3000
- **Prisma Studio**: localhost:5555
- **Postgres**: localhost:5432

### Environment Configuration

Copy the template file and update with your local values:

**macOS / Linux**

```bash
cp .env.development.example .env.development
```

**Windows (PowerShell)**

```powershell
Copy-Item .env.development.example .env.development
```

**Windows (Command Prompt)**

```bat
copy .env.development.example .env.development
```

See [.env.development.example](.env.development.example) for all available options.

### Main Commands

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

### What Happens on Startup

- PostgreSQL container starts
- Prisma migrations applied
- Seed data inserted
- Next.js dev server launched with hot reload

## 🏭 Production (Docker)

Production deployments pull the **GHCR image** and run via Docker Compose with Nginx reverse proxy.

### Ports

- **HTTP (Port 80)**: Nginx listens, redirects to HTTPS
- **HTTPS (Port 443)**: Nginx listens, terminates TLS, proxies to app:3000 (internal)
- **App (Port 3000)**: Only exposed to Nginx container (not to host)
- **Postgres (Port 5432)**: Internal only

### Environment Configuration

Copy the template file and update with your production values:

**macOS / Linux**

```bash
cp .env.production.example .env.production
```

**Windows (PowerShell)**

```powershell
Copy-Item .env.production.example .env.production
```

**Windows (Command Prompt)**

```bat
copy .env.production.example .env.production
```

See [.env.production.example](.env.production.example) for all available options.

⚠️ **Security**: Use strong, unique passwords. `NEXTAUTH_URL` must match your production domain exactly or login will fail.

**Notes**

- `docker:prod` builds locally using the Dockerfile and starts the stack.
- `docker:prod:nobuild` starts without building (use after pulling GHCR).
- To use GHCR directly: `docker pull ghcr.io/pennstatewilkes-barre/afct-dashboard:main` then run `npm run docker:prod:nobuild`.

## 🌐 Nginx (Production Port Forwarding)

**Production only.** Nginx acts as a reverse proxy and TLS terminator:

- **Port 80 (HTTP)**: Client request → Nginx receives → 301 redirect to HTTPS
- **Port 443 (HTTPS)**: Client request → Nginx receives → Terminates TLS → Proxies to app:3000
- **Port 3000 (App)**: Only exposed internally to Nginx container

### Custom SSL Certificates

By default, Nginx generates a self‑signed certificate. To use your own:

1. Place cert and key:
   - `docker/nginx/certs/server.crt`
   - `docker/nginx/certs/server.key`
2. Restart Nginx: `docker compose restart nginx`

## 🏭 Production (Node.js – No Docker)

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

## 🗄️ Database Management

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

## 🔍 Troubleshooting

**Database**

```bash
docker logs afct-dev-postgres                          # View Postgres logs
docker exec -it afct-dev-postgres pg_isready -U afct_user # Check Postgres readiness
```

**Auth / Login**

```bash
docker exec -it afct-dev sh -lc 'echo $NEXTAUTH_URL' # Verify NEXTAUTH_URL in container
docker exec -it afct-dev sh -lc 'echo $NEXTAUTH_SECRET' # Verify NEXTAUTH_SECRET in container
docker logs afct-dev | tail                          # Tail app logs
```

**File Uploads / Permissions**

```bash
docker exec -it afct-dev sh -lc 'ls -ld /private/uploads /app/public/uploads'
```

## 👥 Contributors

| Name                | Affiliation | Email            | GitHub                                        |
| ------------------- | ----------- | ---------------- | --------------------------------------------- |
| Jesse Burdick-Pless | RIT         | -                | [jb4411](https://github.com/jb4411)           |
| Jeffrey Chiampi     | PSU         | jdc308@psu.edu   | [jdc308](https://github.com/jdc308)           |
| Edwin Kismal        | PSU         | etk5176@psu.edu  | [EdwinKimsal](https://github.com/EdwinKimsal) |
| Adam Manowski       | PSU         | ajm9738@psu.edu  | [astemaxed](https://github.com/astemaxed)     |
| Andrew Sutton       | PSU         | ams12165@psu.edu | [asutton24](https://github.com/asutton24)     |
