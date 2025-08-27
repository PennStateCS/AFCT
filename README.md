# AFCT Dashboard

A modern Next.js dashboard for AFCT.

## 🚀 Quick Start

### Prerequisites
- **Docker Desktop** (recommended)
- **Node.js 20+** (for local development)

### Development Setup

1. **Clone the repository**
```bash
git clone <repository-url>
cd afct
```

2. **Start development environment**
```bash
# Option 1: With live logs (recommended for debugging)
npm run docker:dev

# Option 2: In background (detached mode)
npm run docker:dev:detached
```

3. **Open the application**
- Visit: http://localhost:3000
- Database will be automatically migrated and seeded

---

## 🐳 Docker Development (Recommended)

### Main Commands
```bash
# Start development environment
npm run docker:dev                  # With live logs
npm run docker:dev:detached         # In background

# Stop containers
npm run docker:down                 # Graceful stop
Ctrl+C                              # If using live logs mode

# Clean restart (removes data)
npm run docker:down:volumes         # Remove data volumes
npm run docker:nuke                 # Nuclear option - remove everything
```

### What Happens Automatically
- ✅ PostgreSQL database starts and is configured
- ✅ Database migrations run automatically
- ✅ Sample data is seeded
- ✅ Next.js development server starts with hot reload
- ✅ File uploads directory is created

---

## 💻 Local Development (Alternative)

### Setup Local PostgreSQL
```bash
# Install PostgreSQL locally, then:
createdb afct_dev
export DATABASE_URL="postgresql://username:password@localhost:5432/afct_dev"
```

### Run Development Server
```bash
npm install
npm run db:generate               # Generate Prisma client
npm run db:migrate                # Run database migrations
npm run seed                      # Seed sample data
npm run dev                       # Start Next.js dev server
```

---

## 🗄️ Database Management

### Prisma Commands
```bash
# Generate Prisma client (after schema changes)
npm run db:generate

# Create and run new migration
npm run db:migrate

# Open Prisma Studio (database GUI)
npm run db:studio

# Reset database (⚠️ destroys all data)
npm run db:reset

# Seed database with sample data
npm run seed

# Check database performance
npm run db:performance
```

### Docker Database Commands
```bash
# Run Prisma Studio inside Docker container
npm run docker:studio

# Seed database inside Docker container
npm run docker:seed

# Connect directly to PostgreSQL
npm run docker:psql
```

---

## 🛠️ Development Tools

### Code Quality
```bash
npm run lint                      # Check for linting errors
npm run lint:fix                  # Auto-fix linting issues
npm run typecheck                 # TypeScript type checking
```

### Build & Analysis
```bash
npm run build                     # Production build
npm run build:analyze             # Build with bundle analysis
npm run start                     # Start production server
npm run start:prod                # Start production server with PORT
```

### Container Management
```bash
npm run docker:clean              # Clean Docker system
npm run docker:studio             # Open Prisma Studio in container
npm run docker:seed               # Seed database in container
npm run docker:psql               # Connect to PostgreSQL in container
docker ps                         # List running containers
docker logs afct-dashboard        # View app logs
docker logs afct-postgres         # View database logs
```

---

## 📁 Project Structure

```
afct/
├── src/
│   ├── app/                     # Next.js 15 App Router
│   ├── components/              # React components
│   ├── lib/                     # Utilities and configurations
│   └── types/                   # TypeScript type definitions
├── prisma/
│   ├── schema.prisma            # Database schema
│   ├── migrations/              # Database migrations
│   └── seed.ts                  # Sample data seeder
├── public/
│   └── uploads/                 # File upload storage
├── docker-compose.dev.yml       # Development environment
├── Dockerfile.dev               # Development container
└── package.json                 # Dependencies and scripts
```

---

## ⚙️ Java/JAR Configuration

AFCT Dashboard integrates with Java-based code analysis tools for automated grading and feedback. The system includes support for JAR files and native binaries.

### JAR Files Location
```
jars/
├── afct-evaluator.jar           # Main evaluation engine (if present)
└── [other-jar-files]            # Additional Java tools
```

### Binary Files Location
```
bin/
├── cfganalyzer                  # CFG analysis binary (user-provided)
└── README.md                    # Binary documentation
```

### Configuration Variables

The following environment variables control Java/JAR execution:

```env
# Java/JAR Configuration
CFGANALYZER_LIMIT="15"           # Maximum analysis time limit (seconds)
CFGANALYZER_BINARY="/app/bin/cfganalyzer"  # Path to CFG analyzer binary
```

### Setting Up Binaries

1. **Add your CFG analyzer binary:**
```bash
# Copy your binary to the bin directory
cp /path/to/your/cfganalyzer bin/cfganalyzer
chmod +x bin/cfganalyzer  # Make executable (Linux/Mac)
```

2. **Verify binary path in environment:**
```bash
# In .env.development
CFGANALYZER_BINARY="/app/bin/cfganalyzer"
```

3. **Test binary execution (inside Docker):**
```bash
# Connect to container
npm run docker:psql
# Or manually: docker exec -it afct-dashboard sh

# Test binary
ls -la /app/bin/cfganalyzer
/app/bin/cfganalyzer --version  # (if supported)
```

### Java Runtime

- **Docker**: Java 21 (OpenJDK) is included in Docker containers
- **Local development**: Requires Java 21+ installed locally
- **JAR execution**: Handled automatically by the application

### Usage in Application

The Java tools are integrated into:
- **Submission evaluation**: Automated grading of student code
- **Code analysis**: Control flow graph generation
- **Feedback generation**: Detailed analysis reports

---

## 🔧 Environment Variables

Create `.env.development` for local development:
```env
# Database Configuration
DATABASE_URL="postgresql://afct_user:devpassword123@localhost:5432/afct_dev"

# Authentication Configuration
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key"

# Java/JAR Configuration
CFGANALYZER_LIMIT="15"
CFGANALYZER_BINARY="/app/bin/cfganalyzer"

# File Upload Configuration
UPLOAD_DIR="./public/uploads"
MAX_FILE_SIZE="10485760"

# Node Environment
NODE_ENV="development"
```

---

## 📝 Development Workflow

### Daily Development
1. **Start containers**: `npm run docker:dev:detached`
2. **Code changes**: Edit files - hot reload handles updates automatically
3. **Database changes**: 
   - Edit `prisma/schema.prisma`
   - Run `docker exec -it afct-dashboard npx prisma db push` for quick updates
   - Or `npm run db:migrate` for proper migrations
4. **Stop when done**: `npm run docker:down`

### When to Restart Docker
- New dependencies added to `package.json`
- Environment variable changes
- Docker configuration changes
- After major updates

---

## 🔍 Troubleshooting

### Common Issues

**Port already in use:**
```bash
npm run docker:down              # Stop existing containers
docker ps                        # Check for running containers
```

**Database connection errors:**
```bash
docker logs afct-postgres        # Check PostgreSQL logs
docker exec -it afct-postgres pg_isready -U afct_user
```

**Permission errors:**
```bash
# Windows/PowerShell: Enable execution policy
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Container build errors:**
```bash
npm run docker:clean             # Clean Docker system
docker system prune -af          # Nuclear option
```

---

## 📚 Technology Stack

- **Framework**: Next.js 15 (App Router)
- **Database**: PostgreSQL 15
- **ORM**: Prisma
- **UI**: Tailwind CSS + Radix UI
- **Auth**: NextAuth.js v5
- **Language**: TypeScript
- **Container**: Docker + Docker Compose

---

## 🤝 Contributing

1. Create a feature branch
2. Make changes
3. Test with `npm run docker:dev`
4. Run quality checks: `npm run lint && npm run typecheck`
5. Submit pull request

---

*For production deployment instructions, see the production documentation (coming soon).*
