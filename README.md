# AFCT Dashboard

A modern Next.js course management platform with role-based authentication for faculty, TAs, and students. Fully containerized with Docker and optimized for high-performance development and production deployment.

**Stack**: Next.js 15 • TypeScript • Prisma • NextAuth v5 • Tailwind CSS • PostgreSQL • Docker • Java 21

## 🚀 Performance Optimizations

This application includes extensive performance optimizations for both development and production:

### ⚡ Development Speed Enhancements
- **18% faster startup time** (9.7s vs 11.8s baseline)
- **Optimized Docker layer caching** with multi-stage builds
- **Enhanced database performance** with memory tuning and tmpfs mounts
- **Next.js Turbo mode** with webpack optimizations
- **Intelligent file watching** with reduced polling overhead
- **Memory-optimized containers** (6GB Node.js heap, 1GB PostgreSQL)

### 🔧 Database Performance Features
- **Advanced PostgreSQL tuning** for development workloads
- **In-memory storage** (tmpfs) for temporary files and WAL logs
- **Optimized connection pooling** and query execution
- **Performance monitoring tools** built-in
- **Configurable memory allocation** based on workload needs

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
DATABASE_URL="postgresql://afct_user:devpassword123@postgres:5432/afct_dev"
NEXTAUTH_SECRET="your-nextauth-secret-key"
NEXTAUTH_URL="http://localhost:3000"
JWT_SECRET="your-jwt-secret-key"
CFGANALYZER_LIMIT="15"
CFGANALYZER_BINARY="/app/bin/cfganalyzer"
```

3. **Start development environment**:
```bash
# Fast startup (recommended for development)
npm run docker:dev:fast

# Full rebuild if needed
npm run docker:dev:rebuild

# Alternative: standard startup
npm run docker:dev
```

4. **Access the application**:
- Visit `http://localhost:3000`
- Health Check: `http://localhost:3000/api/health`
- Database Studio: `http://localhost:5555` (run `npm run db:studio` in another terminal)

5. **Monitor performance** (optional):
```bash
# Quick database performance check
npm run db:performance

# Monitor container resources
docker stats afct-dashboard afct-postgres-1
```

### Production Deployment

1. **Setup production environment**:
```bash
cp .env.production.template .env.production
# Edit .env.production with your secure values
```

2. **Configure production variables** in `.env.production`:
```env
# Generate secure secrets with: openssl rand -base64 32
POSTGRES_PASSWORD="your_secure_postgres_password_here"
NEXTAUTH_SECRET="your_long_random_nextauth_secret_here"
NEXTAUTH_URL="https://your-domain.com"
JWT_SECRET="your_long_random_jwt_secret_here"
```

3. **Deploy to production**:
```bash
npm run docker:prod
```

4. **Access production application**:
- Visit `http://localhost:3001` (different port to avoid conflicts)
- Health Check: `http://localhost:3001/api/health`
- Database: `localhost:5433` (different port to avoid dev conflicts)

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
mkdir -p bin
cp /path/to/your/cfganalyzer bin/cfganalyzer
chmod +x bin/cfganalyzer  # Make it executable
```

## 🛠️ Available Commands

### Docker Commands
```bash
# Development
npm run docker:dev          # Standard development startup
npm run docker:dev:fast     # Fast startup (recommended)
npm run docker:dev:turbo    # Development with turbo mode
npm run docker:dev:rebuild  # Full rebuild with cache clearing

# Production
npm run docker:prod         # Start production deployment

# Management
npm run docker:down         # Stop all containers
npm run docker:clean        # Stop containers and clean system
```

### Database Commands
```bash
npm run db:migrate          # Run database migrations
npm run db:seed             # Seed database with sample data
npm run db:studio           # Open Prisma Studio
npm run db:reset            # Reset database (development only)
npm run db:deploy           # Deploy migrations (production)
npm run db:performance      # Check database performance stats
```

### Performance Monitoring
```bash
npm run db:performance      # Database performance check
docker stats                # Container resource usage
docker-compose logs app     # Application logs
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

After seeding the database, use these credentials:

- Development seed (default): password `password123`
  - **Admin**: `admin@example.com`
  - **Faculty**: `faculty@example.com`
  - **TA**: `ta@example.com`
  - **Student**: `student@example.com`

- Production seed: a single admin user will be created with the password `Password123!`.
  - **Admin**: `admin@example.com` (password `Password123!`)
  - IMPORTANT: rotate this password immediately after first login or supply a different password via a secure provisioning process.

## 🏗️ Architecture Overview

### Docker Services
- **Development** (optimized for speed):
  - `afct-dashboard`: Next.js application (port 3000)
  - `postgres`: PostgreSQL database (port 5432)
  - **Performance features**: tmpfs mounts, optimized PostgreSQL config, memory tuning
- **Production**:
  - `afct-production`: Next.js application (port 3001)
  - `postgres`: PostgreSQL database (port 5433)
- **Common features**:
  - Health checks for all services
  - Automatic restart policies
  - Volume persistence for data and uploads
  - Resource limits and monitoring

### Performance Features
- **Compilation optimization**: 18% faster startup with intelligent caching
- **Database tuning**: Memory-optimized PostgreSQL with tmpfs storage
- **Container efficiency**: Multi-stage builds with layer caching
- **Development tools**: Built-in performance monitoring and health checks

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
- `.env.production.template` - Secure production template
- `.env.example` - General template with all required variables

### Docker Files
- `Dockerfile` - Production container (multi-stage, security-hardened)
- `Dockerfile.dev` - Development container with hot reload and performance optimizations
- `docker-compose.yml` - Production orchestration
- `docker-compose.dev.yml` - Development orchestration with performance tuning
- `docker-compose.override.yml` - Automatic development optimizations (tmpfs, caching)

### Performance Configuration
- `next.config.ts` - Next.js optimizations (package imports, webpack tuning)
- `tsconfig.json` - TypeScript incremental compilation
- `docs/database-performance.md` - Database optimization guide
- `docs/docker-performance.md` - Docker performance documentation

### Database
- `prisma/schema.prisma` - Single database schema for all environments
- `prisma/migrations/` - Version-controlled schema changes
- `prisma/seed.ts` - Sample data for development

## 🚨 Troubleshooting

### Common Issues

**Slow startup/compilation**:
```bash
# Use optimized startup
npm run docker:dev:fast

# Check performance
npm run db:performance

# Full clean rebuild if needed
npm run docker:clean
npm run docker:dev:rebuild
```

**Containers won't start**:
```bash
docker-compose down
docker system prune -f
npm run docker:dev:fast
```

**Database connection issues**:
```bash
npm run docker:down
docker volume prune -f
npm run docker:dev:fast
```

**Performance issues**:
```bash
# Check container resources
docker stats

# Monitor database performance
npm run db:performance

# Check logs for bottlenecks
docker-compose logs app
docker-compose logs postgres
```

**Permission issues (Linux/Mac)**:
```bash
sudo chown -R $USER:$USER .
chmod +x bin/cfganalyzer
```

**Port conflicts**:
- Development uses ports 3000 (app) and 5432 (database)
- Production uses ports 3001 (app) and 5433 (database)
- Stop other services using these ports if needed

**Java/JAR issues**:
- Ensure `afct-evaluator.jar` is in the `jars/` directory
- Verify CFG analyzer binary is in `bin/cfganalyzer/`
- Check environment variables in your `.env` file

### Logs and Debugging
```bash
# View application logs
docker-compose logs app              # Production
docker-compose -f docker-compose.dev.yml logs app  # Development

# View database logs  
docker-compose logs postgres

# Interactive shell in container
docker-compose exec app sh           # Production
docker exec -it afct-dashboard sh    # Development

# Check health status
curl http://localhost:3000/api/health  # Development
curl http://localhost:3001/api/health  # Production
```

## 📚 Documentation

The `docs/` directory contains comprehensive guides:
- `database-performance.md` - Database optimization and tuning guide
- `docker-performance.md` - Docker performance optimizations
- `development-setup.md` - Development environment setup
- `activity-log-implementation-summary.md` - Activity log system details
- `postgresql-quick-reference.md` - Database administration guide

### Performance Documentation
- **Database tuning**: Memory optimization, query performance, connection pooling
- **Docker optimization**: Layer caching, volume mounts, container efficiency
- **Development tools**: Monitoring scripts, performance testing utilities

## 🎯 Production Checklist

Before deploying to production:

- [ ] Copy `.env.production.template` to `.env.production`
- [ ] Generate secure secrets: `openssl rand -base64 32`
- [ ] Update all placeholder values in `.env.production`
- [ ] Add your CFG analyzer binary to `bin/cfganalyzer`
- [ ] Configure proper domain in `NEXTAUTH_URL`
- [ ] Set up SSL/TLS certificates (reverse proxy recommended)
- [ ] Configure backup strategy for PostgreSQL
- [ ] Test JAR file execution in production environment
- [ ] Verify health checks are working
- [ ] Set up monitoring and logging
- [ ] Configure firewall rules for ports 3001 and 5433

## 🔒 Security Notes

- **Environment Variables**: Never commit `.env.production` to version control
- **Secrets**: Use strong, unique secrets generated with `openssl rand -base64 32`
- **Database**: Change default passwords and use environment variable substitution
- **Containers**: Production containers run as non-root user for security
- **Health Checks**: Monitor `/api/health` endpoint for service status

---

**Ready to develop?** Run `npm run docker:dev:fast` and visit `http://localhost:3000`

**Need maximum performance?** The development environment includes extensive optimizations:
- 18% faster startup times
- Optimized database configuration  
- Memory-efficient containers
- Built-in performance monitoring

**Ready for production?** Use the template: `cp .env.production.template .env.production`, configure your secrets, then run `npm run docker:prod`

**Monitoring performance?** Use `npm run db:performance` to check database optimization status

**Need help?** Check the troubleshooting section, review the Docker logs, or visit the health check endpoint.
