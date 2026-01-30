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

## 🚀 Quick Start Guide

### Prerequisites
- Docker Desktop (recommended)
- Node.js 20+ (optional for non-Docker dev)
- Git (for cloning the repo)
- PostgreSQL 15+ (required for non-Docker dev)
- Java 21+ (required for non-Docker dev)

### Development Setup

```bash
git clone <repository-url>
cd afct
npm run docker:dev
```

Visit: http://localhost:3000

## 🐳 Docker Development (Recommended)

### Main Commands
```bash
npm run docker:dev
npm run docker:dev:detached
npm run docker:dev:seed
npm run docker:dev:migrate
npm run docker:dev:psql
npm run docker:dev:down
npm run docker:dev:clean
npm run docker:dev:down:volumes
npm run docker:dev:nuke
```

**What these do**
- `docker:dev`: Build and run the dev stack in the foreground (logs attached).
- `docker:dev:detached`: Build and run the dev stack in the background.
- `docker:dev:seed`: Run Prisma seed inside the dev app container.
- `docker:dev:migrate`: Run Prisma migrations inside the dev app container.
- `docker:dev:psql`: Open psql against the dev Postgres container.
- `docker:dev:down`: Stop dev containers (keeps volumes).
- `docker:dev:clean`: Stop dev containers and prune unused Docker resources.
- `docker:dev:down:volumes`: Stop dev containers and remove volumes (data reset).
- `docker:dev:nuke`: Remove dev containers, volumes, and all unused Docker data.

### What Happens on Startup
- PostgreSQL container starts
- Prisma migrations applied
- Seed data inserted
- Next.js dev server launched with hot reload

## 🏭 Production (Docker)

Production deployments typically pull the **GHCR image** and run via Docker Compose.

### Environment (`.env`)
```env
POSTGRES_PASSWORD=change-me
NEXTAUTH_URL=http://10.144.18.20:3000
NEXTAUTH_SECRET=change-me
JWT_SECRET=change-me
NODE_ENV=production
```

⚠️ `NEXTAUTH_URL` must exactly match the browser URL or login may fail with `MissingCSRF`.

### Main Commands
```bash
npm run docker:prod
npm run docker:prod:nobuild
npm run docker:prod:down
npm run docker:prod:logs
npm run docker:prod:logs:app
npm run docker:prod:logs:db
npm run docker:prod:migrate
npm run docker:prod:seed
```

**What these do**
- `docker:prod`: Build and start the production stack in detached mode.
- `docker:prod:nobuild`: Start the production stack without rebuilding.
- `docker:prod:down`: Stop the production stack.
- `docker:prod:logs`: Follow logs for all production services.
- `docker:prod:logs:app`: Follow logs for the app service only.
- `docker:prod:logs:db`: Follow logs for the database service only.
- `docker:prod:migrate`: Run Prisma migrations inside the app container.
- `docker:prod:seed`: Run the production seed script inside the app container.

**Notes**
- `docker:prod` builds locally using the Dockerfile and starts the stack.
- `docker:prod:nobuild` starts without building (use after pulling GHCR).
- To use GHCR directly: `docker pull ghcr.io/pennstatewilkes-barre/afct-dashboard:main` then run `npm run docker:prod:nobuild`.

## 🏭 Production (Node.js – No Docker)
```bash
npm install
npm run build
npm run db:deploy
npm start
```

Requires:
- Node.js 20+
- PostgreSQL 15+
- Java 21+

Required env vars:
- DATABASE_URL
- NEXTAUTH_URL
- NEXTAUTH_SECRET
- JWT_SECRET

## 🗄️ Database Management

### Prisma (Local / Node)
```bash
npm run db:generate
npm run db:migrate
npm run db:deploy
npm run db:studio
npm run db:reset
npm run seed
```

### Inside Docker
```bash
npm run docker:dev:studio
npm run docker:dev:seed
npm run docker:dev:psql
```

---

## 🔍 Troubleshooting

**Database**
```bash
docker logs afct-dev-postgres
docker exec -it afct-dev-postgres pg_isready -U afct_user
```

**Auth / Login**
```bash
docker exec -it afct-dev sh -lc 'echo $NEXTAUTH_URL'
docker logs afct-dev | tail
```


## 📚 Tech Stack

- Node.js 20+
- Next.js 15
- PostgreSQL + Prisma
- Auth.js / NextAuth v5
- Tailwind CSS
- Docker + GHCR

## 👥 Contributors

| Name | Affiliation | Email | GitHub |
| --- | --- | --- | --- |
| Jesse Burdick-Pless | RIT | - | [jb4411](https://github.com/jb4411) |
| Jeffrey Chiampi | PSU | jdc308@psu.edu | [jdc308](https://github.com/jdc308) |
| Edwin Kismal | PSU | etk5176@psu.edu | [EdwinKimsal](https://github.com/EdwinKimsal) |
| Adam Manowski | PSU | ajm9738@psu.edu | [astemaxed](https://github.com/astemaxed) |
| Andrew Sutton | PSU |  ams12165@psu.edu | [asutton24](https://github.com/asutton24) |





