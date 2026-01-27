# AFCT Dashboard

A modern **Next.js 15** dashboard for the **Automated Feedback for CS Theory (AFCT)** system.  
Built with **PostgreSQL, Prisma, NextAuth.js, Tailwind, and Docker**.

---

![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)
![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![Prisma](https://img.shields.io/badge/Prisma-ORM-blue?logo=prisma)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript)

---

## 🚀 Quick Start

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (recommended)
- [Node.js 20+](https://nodejs.org/en) (if developing outside Docker)

### Development Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd afct
   ```

2. **Start the dev environment**
   ```bash
   # With live logs (recommended for debugging)
   npm run docker:dev

   # Detached/background mode
   npm run docker:dev:detached
   ```

3. **Open the app**
   - Visit: [http://localhost:3000](http://localhost:3000)  
   - Database is automatically migrated and seeded on startup
   - Dev database: postgres://afct_user:devpassword123@localhost:5432/afct_dev

---

## 🐳 Docker Development (Recommended)

### Main Commands
```bash
npm run docker:dev          # Start with live logs
npm run docker:dev:detached # Start in background
npm run docker:down         # Stop containers
npm run docker:clean        # Prune unused Docker data
```

### Docker Image (GHCR) + CI Build Records

This repo builds and publishes a Docker image automatically using **GitHub Actions** whenever we maerge to `main`.

- **Workflow:** [Docker build workflow](./.github/workflows/docker.yml)
- **Dockerfile:** [Dockerfile](./Dockerfile)

#### Published images (GHCR)

- Stable tag (latest from `main`):
  - `ghcr.io/pennstatewilkes-barre/afct-dashboard:main`

- Immutable tag (specific commit build):
  - `ghcr.io/pennstatewilkes-barre/afct-dashboard:sha-<commit_sha>`

#### Build record archive (Docker Desktop)

Each workflow run uploads a **Docker build record archive** (`*.dockerbuild`) you can import into Docker Desktop:

1. Go to the workflow run in GitHub Actions
2. Download the `*.dockerbuild` artifact (example: `PennStateWilkes-Barre~AFCT-Dashboard~SQD53D.dockerbuild`)
3. In Docker Desktop → **Builds** → **Import**, select the downloaded file

Build records include timing, dependencies, logs, traces, and more.


### Reset Options
```bash
npm run docker:down:volumes # Stop + remove database volume (reset data)
npm run docker:nuke         # Remove containers, volumes, images (full reset)
```

### What Happens on Startup
- ✅ PostgreSQL container starts  
- ✅ Prisma migrations applied  
- ✅ Seed data inserted (users + courses)  
- ✅ Next.js dev server launched with hot reload  
- ✅ Uploads directory initialized  

---

## � Production (Docker)

Ensure `.env.production` is configured with your secrets. The app runs on http://localhost:3001 and Postgres on port 5433.

Minimal `.env.production` example:
```env
# Postgres
POSTGRES_PASSWORD=change-me
DATABASE_URL=postgresql://afct_user:${POSTGRES_PASSWORD}@postgres:5432/afct

# NextAuth
NEXTAUTH_URL=http://localhost:3001
NEXTAUTH_SECRET=change-me
AUTH_TRUST_HOST=true

# Analyzer and uploads
CFGANALYZER_LIMIT=15
CFGANALYZER_BINARY=/app/bin/cfganalyzer
UPLOAD_DIR=/app/public/uploads
MAX_FILE_SIZE=10485760
NODE_ENV=production
```

### Main Commands
```bash
npm run docker:prod          # Build and start in background
npm run docker:prod:nobuild  # Start already-built images
npm run docker:prod:down     # Stop containers
npm run docker:prod:restart  # Restart without rebuilding
```

### Observe & Operate
```bash
npm run docker:prod:ps          # Show status
npm run docker:prod:logs        # Tail all logs
npm run docker:prod:logs:app    # Tail app logs only
npm run docker:prod:logs:db     # Tail DB logs only
npm run docker:prod:exec:app    # Shell into app container
npm run docker:prod:exec:db     # psql into database
```

### Database
```bash
npm run docker:prod:migrate   # Apply migrations in production
npm run docker:prod:seed      # Run prisma/seed.ts in production
```

Notes:
- App: http://localhost:3001  (mapped from container port 3000)
- Postgres: localhost:5433 (user: afct_user; db: afct)
- Uploads volume persists at `uploads_data`

---

## �💻 Local Development (Alternative)

1. **Run PostgreSQL locally**
   ```bash
   createdb afct_dev
   export DATABASE_URL="postgresql://username:password@localhost:5432/afct_dev"
   ```

2. **Install & start**
   ```bash
   npm install
   npm run db:generate
   npm run db:migrate
   npm run seed
   npm run dev
   ```

---

## 🗄️ Database Management

### Prisma
```bash
npm run db:generate   # Generate client after schema changes
npm run db:migrate    # Create/run migrations
npm run db:deploy     # Apply pending migrations without creating new ones
npm run db:studio     # Open Prisma Studio
npm run db:reset      # Drop + recreate database
npm run seed          # Seed sample data
```

### Inside Docker
```bash
npm run docker:studio # Prisma Studio in container
npm run docker:seed   # Seed database in container
npm run docker:psql   # Connect to Postgres directly
```

---

## 📁 Project Structure

```
afct/
├── src/                 # Application code
│   ├── app/             # Next.js App Router
│   ├── components/      # UI components
│   ├── lib/             # Utilities & configs
│   └── types/           # TypeScript types
├── prisma/
│   ├── schema.prisma    # Database schema
│   ├── migrations/      # Migration history
│   └── seed.ts          # Seeder script
├── public/
│   └── uploads/         # File uploads
├── Dockerfile.dev       # Dev container
├── Dockerfile           # Production container
├── docker-compose.dev.yml
├── docker-compose.yml   # Production compose file
├── prisma.config.ts     # Prisma config (includes seed command)
└── package.json
```

---

## ⚙️ Java & Binaries

The dashboard integrates with Java-based tools (JARs) and native binaries for automated grading/analysis.

### Layout
```
jars/
├── afct-evaluator.jar     # Evaluation engine
└── other-jar-files…

bin/
├── cfganalyzer            # CFG analyzer binary
└── README.md
```

### Configuration
```env
CFGANALYZER_LIMIT=15
CFGANALYZER_BINARY=/app/bin/cfganalyzer
```

### Setup
```bash
cp /path/to/cfganalyzer bin/cfganalyzer
chmod +x bin/cfganalyzer
```

- Docker includes **Java 21 (OpenJDK)** by default  
- Local dev requires **Java 21+**

---

## 🔧 Environment Variables

Create `.env.development`:

| Variable             | Purpose                                |
|----------------------|----------------------------------------|
| `DATABASE_URL`       | Postgres connection string             |
| `NEXTAUTH_URL`       | Base URL for NextAuth                  |
| `NEXTAUTH_SECRET`    | Secret for NextAuth JWT/session        |
| `CFGANALYZER_LIMIT`  | Max analysis time (seconds)            |
| `CFGANALYZER_BINARY` | Path to CFG analyzer binary            |
| `UPLOAD_DIR`         | File upload directory                  |
| `MAX_FILE_SIZE`      | Upload size limit (bytes)              |
| `NODE_ENV`           | Node environment (`development`)       |

---

## 📝 Development Workflow

### Typical Day
1. Start containers: `npm run docker:dev:detached`  
2. Code — hot reload handles changes  
3. Update schema → run `npm run db:migrate`  
4. Done? Stop with `npm run docker:down`

### Restart Needed When:
- Added new dependencies
- Changed env vars
- Edited Dockerfiles or compose
- Major updates

---

## 🔍 Troubleshooting

**Port already in use**
```bash
npm run docker:down
docker ps
```

**Database connection issues**
```bash
docker logs afct-postgres
docker exec -it afct-postgres pg_isready -U afct_user
```

**Build failures**
```bash
npm run docker:clean
docker system prune -af   # Hard reset
```

---

## 📚 Tech Stack

- **Framework**: Next.js 15 (App Router)  
- **DB**: PostgreSQL 15 + Prisma ORM  
- **UI**: Tailwind CSS, Radix UI  
- **Auth**: NextAuth.js v5  
- **Lang**: TypeScript  
- **Containers**: Docker + Compose  

---

## 🤝 Contributing

1. Create a feature branch  
2. Make changes  
3. Run with `npm run docker:dev`  
4. Lint & typecheck: `npm run lint && npm run typecheck`  
5. Open a pull request  

---

✨ *For production deployment, see [Production Docs](./docs/production.md) (coming soon).*
