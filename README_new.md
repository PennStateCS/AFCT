# AFCT Dashboard

A modern Next.js course management platform with role-based authentication for faculty, TAs, and students.

**Stack**: Next.js 15 • TypeScript • Prisma 7 • NextAuth v5 • Tailwind CSS • SQLite/PostgreSQL

## Quick Start

### Prerequisites
- Node.js 18+
- Git

### Installation

```bash
git clone <repository-url>
cd afct
npm install
```

### Setup

**Option 1: Automated Setup (Recommended)**
```bash
./scripts/setup-wizard.sh
```
Choose "Complete Development Setup" for local dev or "Complete Production Setup" for deployment.

**Option 2: Manual Development Setup**
```bash
cp .env.example .env.local
npm run db:generate
npm run db:migrate
npm run seed
npm run dev
```

### Access

Visit `http://localhost:3000`

**Default credentials** (password: `password123`):
- Admin: `admin@example.com`
- Faculty: `faculty@example.com` 
- Student: `student@example.com`

## Production Deployment

```bash
# On Linux server
./scripts/setup-wizard.sh
# Choose "Complete Production Setup"
```

## Commands

```bash
npm run dev              # Start development
npm run build           # Build for production
npm run db:migrate      # Run migrations
npm run seed            # Seed database
npm run db:test         # Test database connection
```

## Troubleshooting

**Database issues**: `npm run db:test` or `./scripts/setup-wizard.sh`

**Build errors**: 
```bash
rm -rf .next node_modules
npm install && npm run build
```

**Migration issues**: `npx prisma migrate reset && npx prisma migrate dev`

## Environment

Required `.env.local` variables:
```env
DATABASE_URL="file:./prisma/dev.db"
JWT_SECRET="your-secret-key"
NEXTAUTH_SECRET="your-nextauth-secret"
NEXTAUTH_URL="http://localhost:3000"
```

## User Roles

- **Admin**: Full system access and user management
- **Faculty**: Course creation, assignment management, grading
- **TA**: Assignment grading and student interaction  
- **Student**: Course enrollment, assignment submission, grade viewing

## Documentation

- [Development Setup Guide](docs/development-setup.md) - Windows & Linux setup instructions
- [PostgreSQL Setup Guide](docs/postgresql-ubuntu-setup.md)
- [Database Troubleshooting](docs/database-troubleshooting.md)

---

**Need help?** Run `./scripts/setup-wizard.sh` for interactive guidance.
