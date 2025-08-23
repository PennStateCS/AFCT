# AFCT Dashboard

A modern Next.js course management platform with role-based authentication for faculty, TAs, and students. Now fully containerized with Docker for easy development and production deployment.

**Stack**: Next.js 15 • TypeScript • Prisma • NextAuth v5 • Tailwind CSS • PostgreSQL • Docker • Java 21

## 🚀 Quick Start with Docker

### Prerequisites
- Docker Desktop (Windows/Mac) or Docker Engine (Linux)
- Docker Compose
- Git

### Development Setup

1. **Clone and setup environment**:
```bash
git clone <repository-url>
cd afct
cp .env.example .env.development
```

2. **Configure environment variables** in `.env.development`:
```env
DATABASE_URL="postgresql://afct_user:afct_password@db:5432/afct_dev"
NEXTAUTH_SECRET="your-nextauth-secret-key"
NEXTAUTH_URL="http://localhost:3000"
JWT_SECRET="your-jwt-secret-key"
CFGANALYZER_LIMIT="15"
CFGANALYZER_BINARY="/app/bin/cfganalyzer"
```

3. **Start development environment**:
```bash
npm run docker:dev
```

4. **Access the application**:
- Visit `http://localhost:3000`
- Database Studio: `http://localhost:5555` (run `npm run db:studio` in another terminal)

### Production Deployment

1. **Setup production environment**:
```bash
cp .env.example .env.production
```

2. **Configure production variables** in `.env.production`:
```env
DATABASE_URL="postgresql://afct_user:secure_password@db:5432/afct_prod"
NEXTAUTH_SECRET="secure-production-secret"
NEXTAUTH_URL="https://your-domain.com"
JWT_SECRET="secure-jwt-secret"
CFGANALYZER_LIMIT="15"
CFGANALYZER_BINARY="/app/bin/cfganalyzer"
```

3. **Deploy to production**:
```bash
npm run docker:prod
```

## 📁 JAR Files and Binaries

### Java JAR Files
Location: `jars/`

- **`afct-evaluator.jar`**: Main evaluation engine for assignment submissions
  - Requires Java 21 (included in Docker containers)
  - Used by the submission API endpoint
  - Handles automated grading and feedback generation

### Binary Dependencies
Location: `bin/`

- **`bin/cfganalyzer/`**: CFG (Control Flow Graph) analyzer binary
  - **Required**: You must add your CFG analyzer binary to this directory
  - **Environment Variable**: `CFGANALYZER_BINARY` points to this location
  - **Usage**: Referenced by `afct-evaluator.jar` for code analysis

**To add your binary**:
```bash
# Copy your CFG analyzer binary to the bin directory
mkdir -p bin/cfganalyzer
cp /path/to/your/cfganalyzer bin/cfganalyzer/
```

## 🛠️ Available Commands

### Docker Commands
```bash
npm run docker:dev          # Start development with hot reload
npm run docker:prod         # Start production deployment
npm run docker:down         # Stop all containers
npm run docker:build        # Build containers without starting
```

### Database Commands
```bash
npm run db:migrate          # Run database migrations
npm run db:seed             # Seed database with sample data
npm run db:studio           # Open Prisma Studio
npm run db:reset            # Reset database (development only)
npm run db:deploy           # Deploy migrations (production)
```

### Development Commands
```bash
npm run dev                 # Local development (non-Docker)
npm run build               # Build for production
npm run start               # Start production server
npm run lint                # Run ESLint
npm run type-check          # TypeScript type checking
```

## 🔐 Default Login Credentials

After seeding the database, use these credentials (password: `password123`):

- **Admin**: `admin@example.com`
- **Faculty**: `faculty@example.com` 
- **TA**: `ta@example.com`
- **Student**: `student@example.com`

## 🏗️ Architecture Overview

### Docker Services
- **app**: Next.js application (ports 3000/3001)
- **db**: PostgreSQL database (port 5432)
- **volumes**: Persistent storage for database and uploads

### Environment Detection
The application automatically detects Docker environment and adjusts:
- Database connections
- File paths for JAR execution
- Java runtime configuration

### Java Integration
- **Runtime**: OpenJDK 21 in Docker containers
- **JAR Execution**: Custom `JavaRunner` utility
- **Environment Variables**: Automatic configuration for binary paths

## 🗂️ User Roles & Permissions

- **Admin**: Full system access, user management, system configuration
- **Faculty**: Course creation, assignment management, grading, student oversight
- **TA**: Assignment grading, student interaction, limited course management
- **Student**: Course enrollment, assignment submission, grade viewing

## 🔧 Configuration Files

### Environment Files
- `.env.development` - Development configuration
- `.env.production` - Production configuration
- `.env.example` - Template with all required variables

### Docker Files
- `Dockerfile` - Production container
- `Dockerfile.dev` - Development container with hot reload
- `docker-compose.yml` - Production orchestration
- `docker-compose.dev.yml` - Development orchestration

### Database
- `prisma/schema.prisma` - Single database schema for all environments
- `prisma/migrations/` - Version-controlled schema changes
- `prisma/seed.ts` - Sample data for development

## 🚨 Troubleshooting

### Common Issues

**Containers won't start**:
```bash
docker-compose down
docker system prune -f
npm run docker:dev
```

**Database connection issues**:
```bash
npm run docker:down
docker volume prune -f
npm run docker:dev
```

**Permission issues (Linux)**:
```bash
sudo chown -R $USER:$USER .
chmod +x bin/cfganalyzer/*
```

**Java/JAR issues**:
- Ensure `afct-evaluator.jar` is in the `jars/` directory
- Verify CFG analyzer binary is in `bin/cfganalyzer/`
- Check environment variables in your `.env` file

### Logs and Debugging
```bash
# View application logs
docker-compose logs app

# View database logs  
docker-compose logs db

# Interactive shell in container
docker-compose exec app bash
```

## 📚 Documentation

The `docs/` directory contains additional guides:
- Activity log implementation details
- Java integration examples
- Database schema documentation

## 🎯 Production Checklist

Before deploying to production:

- [ ] Update `.env.production` with secure credentials
- [ ] Add your CFG analyzer binary to `bin/cfganalyzer/`
- [ ] Configure proper domain in `NEXTAUTH_URL`
- [ ] Set up SSL/TLS certificates
- [ ] Configure backup strategy for PostgreSQL
- [ ] Test JAR file execution in production environment

---

**Ready to develop?** Run `npm run docker:dev` and visit `http://localhost:3000`

**Need help?** Check the troubleshooting section or review the Docker logs.
