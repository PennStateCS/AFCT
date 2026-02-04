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

- [Quick Start Guide](#-quick-start-guide)
- [Tech Stack](#-tech-stack)
- [Docker Development (Recommended)](#-docker-development-recommended)
- [Production (Docker)](#-production-docker)
- [SSL / Custom Certificates (Nginx)](#-ssl--custom-certificates-nginx)
- [Production (Node.js – No Docker)](#-production-nodejs--no-docker)
- [Database Management](#-database-management)
- [Troubleshooting](#-troubleshooting)
- [Contributors](#-contributors)

## 🚀 Quick Start Guide

### Prerequisites

- Docker Desktop (recommended)
- Node.js 20+ (optional for non-Docker dev)

### Development Setup

```bash
git clone <repository-url>
cd afct
npm run docker:dev
```

Visit: http://localhost:3000

## 📚 Tech Stack

- Node.js 20+
- Next.js 15
- PostgreSQL + Prisma
- Auth.js / NextAuth v5
- Tailwind CSS
- Docker + GHCR

## 🐳 Docker Development (Recommended)

### Environment (`.env.develepment`)

```env
# Database Configuration
DATABASE_URL=postgresql://afct_user:afct_password@db:5432/afct_dev

# Authentication Configuration
NEXTAUTH_SECRET=your-nextauth-secret-change-this-in-production
NEXTAUTH_URL=http://localhost:3000
JWT_SECRET=your-jwt-secret-key-change-this-in-production

# Java/JAR Configuration
CFGANALYZER_LIMIT=15
CFGANALYZER_BINARY=/app/bin/cfganalyzer

# File Upload Configuration
MAX_FILE_SIZE=10485760

# Node Environment
NODE_ENV=development
```

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

Production deployments typically pull the **GHCR image** and run via Docker Compose.

### Environment (`.env.production`)

```env
# Database Configuration
POSTGRES_PASSWORD=change_me_now_with_a_strong_password
DATABASE_URL=postgresql://afct_user:change_me_now_with_a_strong_password@postgres:5432/afct

# Admin Account Configuration (required for production seed)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=Password123!
DEFAULT_ADMIN_FIRST_NAME=Admin
DEFAULT_ADMIN_LAST_NAME=User

# Authentication Configuration
NEXTAUTH_SECRET=secure-production-secret
NEXTAUTH_URL=http://10.144.18.20
AUTH_TRUST_HOST=true
JWT_SECRET=secure-jwt-secret

# Java/JAR Configuration
CFGANALYZER_LIMIT=15
CFGANALYZER_BINARY=/app/bin/cfganalyzer

# File Upload Configuration
MAX_FILE_SIZE=10485760

# Node Environment
NODE_ENV=production

# Enable automatic seeding in production
SEED_ON_START=true
```

⚠️ `NEXTAUTH_URL` must exactly match the browser URL or login may fail with `MissingCSRF`.

### Admin Seed (Production)

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `DEFAULT_ADMIN_FIRST_NAME`, and `DEFAULT_ADMIN_LAST_NAME` in `.env.production` to create the initial admin user on first database setup. Use a strong, unique password and rotate it after the first login. If seeding should run automatically on container start, set `SEED_ON_START=true`.

### Main Commands

```bash
npm run docker:prod           # Build and start
npm run docker:prod:nobuild   # Start without rebuilding
npm run docker:prod:down      # Stop the stack
npm run docker:prod:logs      # Follow logs
npm run docker:prod:logs:app  # Follow app logs
npm run docker:prod:logs:db   # Follow db logs
npm run docker:prod:migrate   # Run migrate
npm run docker:prod:seed      # Run seed
```

**Notes**

- `docker:prod` builds locally using the Dockerfile and starts the stack.
- `docker:prod:nobuild` starts without building (use after pulling GHCR).
- To use GHCR directly: `docker pull ghcr.io/pennstatewilkes-barre/afct-dashboard:main` then run `npm run docker:prod:nobuild`.

## 🔐 SSL / Custom Certificates (Nginx)

By default, nginx generates a **self‑signed** certificate on first start. You can replace it with your own certificate at any time.

### Replace the certificate (dev or prod)

1. Place your cert and key in the nginx certs folder:
   - `docker/nginx/certs/server.crt`
   - `docker/nginx/certs/server.key`
2. Restart nginx:
   - Dev: `docker compose -f docker-compose.dev.yml restart nginx`
   - Prod: `docker compose restart nginx`

### Ports

- HTTP redirect: `3001` → `80`
- HTTPS: `3002` → `443`

> Tip: If you don’t have a domain, the self‑signed cert is fine for local/testing. Browsers will show a warning until you trust the cert.

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
docker logs afct-dev | tail                          # Tail app logs
```

## 👥 Contributors

| Name                | Affiliation | Email            | GitHub                                        |
| ------------------- | ----------- | ---------------- | --------------------------------------------- |
| Jesse Burdick-Pless | RIT         | -                | [jb4411](https://github.com/jb4411)           |
| Jeffrey Chiampi     | PSU         | jdc308@psu.edu   | [jdc308](https://github.com/jdc308)           |
| Edwin Kismal        | PSU         | etk5176@psu.edu  | [EdwinKimsal](https://github.com/EdwinKimsal) |
| Adam Manowski       | PSU         | ajm9738@psu.edu  | [astemaxed](https://github.com/astemaxed)     |
| Andrew Sutton       | PSU         | ams12165@psu.edu | [asutton24](https://github.com/asutton24)     |
