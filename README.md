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
npm run docker:down
npm run docker:clean
npm run docker:down:volumes
npm run docker:nuke
```

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
docker compose --env-file .env up -d
docker compose down
docker pull ghcr.io/pennstatewilkes-barre/afct-dashboard:main
```

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
npm run docker:studio
npm run docker:seed
npm run docker:psql
```

---

## 🔍 Troubleshooting

**Database**
```bash
docker logs afct-pg
docker exec -it afct-pg pg_isready -U afct_user
```

**Auth / Login**
```bash
docker exec -it afct-app sh -lc 'echo $NEXTAUTH_URL'
docker logs afct-app | tail
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





