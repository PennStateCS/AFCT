# 📚 AFCT Dashboard

A modern **Next.js 15** application serving as a role-based course management platform for faculty, TAs, and students. Built with TypeScript, Prisma ORM, and designed for cross-platform development and deployment.

## ✨ Features

- 🔐 **Role-based authentication** (Admin, Faculty, TA, Student)
- 📝 **Assignment management** with file uploads
- 💬 **Comments system** with student-specific filtering
- 📊 **Grade tracking** and submission management
- 🎨 **Modern UI** with Tailwind CSS and shadcn/ui
- 🗄️ **Database flexibility** (SQLite for development, PostgreSQL for production)
- 🚀 **Cross-platform** development and deployment

## 🔧 Troubleshooting

### Automated Troubleshooting Tools

**🆕 NEW**: The setup wizard now includes comprehensive troubleshooting tools!

```bash
# Run the setup wizard
./scripts/setup-wizard.sh

# Choose from new troubleshooting options:
# 12) System Health Check    - Check system requirements and status
# 13) View System Status     - Show installed components and versions
# 14) Database Troubleshooting - Diagnose and fix database issues
```

### Database Connection Testing

**Test your database connections easily:**

```bash
# Test development database (SQLite)
npm run db:test

# Test production database (PostgreSQL)
npm run db:test:prod
```

### ERD Generation Issues

**Fixed common ERD generation problems:**

```bash
# Safe generation without ERD (always works)
npm run db:generate:safe

# Generation with ERD (requires Chrome/Chromium)
npm run db:generate:with-erd

# The wizard now detects Chrome compatibility automatically!
```

### Common Issues

- Prisma "invalid port number in database URL": ensure .env.production has no quotes around DATABASE_URL and credentials are URL-encoded (especially special characters in the password). Example: postgresql://user:pa%40%23%24ss@host:5432/db

---

## 🛠️ Tech Stack

- **Frontend**: Next.js 15, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API Routes, Prisma ORM
- **Database**: SQLite (development), PostgreSQL (production)
- **Authentication**: JWT-based auth system
- **Deployment**: Linux-ready with automated scripts

---

## ⚡ Super Quick Setup (Recommended)

**🎯 For beginners or anyone who wants everything set up automatically:**

```bash
git clone <repository-url>
cd afct

# Run the automated setup wizard
./scripts/setup-wizard.sh
```

Choose "Complete Development Setup" for a full development environment or "Complete Production Setup" for production deployment. The wizard handles everything automatically!

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** - [Download here](https://nodejs.org/en/download)
- **Git** - [Download here](https://git-scm.com/downloads)
- **PostgreSQL** (for production) - Use our automated scripts below

### 1️⃣ Clone and Install

```bash
git clone <repository-url>
cd afct
npm install
```

### 2️⃣ Environment Setup

Copy the environment template:

```bash
# Windows (PowerShell)
Copy-Item .env.example .env.local

# macOS/Linux
cp .env.example .env.local
```

### 3️⃣ Easy Setup (Recommended for Beginners)

**🎯 One-Click Setup Wizard** - Perfect for users with no experience!

```bash
# Make the wizard executable
chmod +x scripts/setup-wizard.sh

# Run the interactive setup wizard
./scripts/setup-wizard.sh
```

The setup wizard provides a menu-driven interface that handles everything for you:

- **📝 Development Setup**: Complete development environment (Node.js + SQLite + App)
- **🚀 Production Setup**: Full production deployment (Node.js + PostgreSQL + App)
- **🔧 Individual Components**: Install Node.js, databases, or dependencies separately
- **⚙️ Utilities**: Test connections, reset databases, system health checks

**Benefits:**

- ✅ Beginner-friendly with step-by-step guidance
- ✅ Handles existing installations gracefully
- ✅ Automatic error detection and recovery
- ✅ Cross-platform compatibility (Ubuntu/CentOS)
- ✅ Built-in troubleshooting and status checks

### 4️⃣ Manual PostgreSQL Setup (Advanced Users)

For advanced users who prefer manual control:

#### Option A: Complete Setup (Recommended)

```bash
# Make scripts executable
chmod +x scripts/*.sh

# Run comprehensive PostgreSQL setup
sudo ./scripts/setup-postgresql.sh
```

This script will:

- ✅ Install PostgreSQL and dependencies
- ✅ Configure security settings
- ✅ Create application database and user (handles existing resources gracefully)
- ✅ Set up automated backups
- ✅ Configure firewall
- ✅ Install Node.js and PM2
- ✅ Create production environment file

**Note**: Scripts are designed to be re-runnable and will intelligently handle existing databases, users, and configurations.

#### Option B: Quick Setup

```bash
# For faster, streamlined setup
sudo ./scripts/quick-postgresql-setup.sh
```

#### Option C: Connection Testing

```bash
# If you have issues with database connections
./scripts/setup-wizard.sh  # Choose option 9: Test Database Connection
```

See [PostgreSQL Setup Guide](docs/postgresql-ubuntu-setup.md) for detailed manual installation.

### 5️⃣ Database Setup

#### Using the Setup Wizard (Recommended)

If you used the setup wizard (`./scripts/setup-wizard.sh`), your database is already configured and ready to use!

#### Manual Database Setup

##### For Development (SQLite)

```bash
# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# Seed with sample data
npm run seed
```

##### For Production (PostgreSQL)

If you used the automated PostgreSQL setup scripts, the database is already configured. Use the production-safe commands that load .env.production automatically:

```bash
# Generate Prisma client for PostgreSQL using production schema and env
yarn db:generate:prod # or: npm run db:generate:prod

# Apply migrations to production database
yarn db:migrate:prod  # or: npm run db:migrate:prod

# Seed production database (uses unified prisma/seed.ts)
yarn seed:prod        # or: npm run seed:prod
```

### 6️⃣ Start Development Server

```bash
npm run dev
```

Visit **http://localhost:3000** to see your application.

### 🔑 Default Login Credentials

All users have the password: `password123`

- Admin: `admin@example.com`
- Faculty: `faculty@example.com`, `faculty2@example.com`, `faculty1@example.com`
- TA: `ta1@example.com`, `ta2@example.com`
- Students: `student@example.com`, `student1@example.com` … `student25@example.com`

---

## 🏗️ Development Guide

### Platform-Specific Setup

#### Windows

```powershell
# If you get PowerShell execution policy errors:
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Unrestricted

# Install dependencies
npm install

# Start development
npm run dev
```

#### macOS/Linux

```bash
# Install dependencies
npm install

# Start development
npm run dev
```

### Environment Configuration

The project uses three environment files:

- `.env` - Default configuration (committed to repo)
- `.env.local` - Local development overrides (not committed)
- `.env.production` - Production configuration (not committed)

Required variables:

```env
# Database
DATABASE_URL="file:./dev.db"  # SQLite for development
# For production, we use .env.production with a postgresql:// URL

# JWT
JWT_SECRET="your-super-secret-jwt-key-here"

# File Upload
UPLOAD_DIR="./public/uploads"
MAX_FILE_SIZE="10485760"  # 10MB
```

### Database Management

#### Development Commands

```bash
# Generate Prisma client (after schema changes)
npx prisma generate

# Create and apply new migration
npx prisma migrate dev --name your_migration_name

# Reset database (drops all data and re-runs migrations + seed)
npx prisma migrate reset

# Seed database with sample data
npm run seed

# Open database browser (Prisma Studio)
npx prisma studio
```

#### ERD (Entity Relationship Diagram) Generation

ERD generation is optional and only available in development mode:

```bash
# Generate ERD diagram (requires Chrome/Chromium)
npm run db:generate:with-erd

# Safe generation without ERD (fallback)
npm run db:generate:safe

# Install Chrome/Chromium for ERD support (Ubuntu)
sudo apt install chromium-browser
```

Note: The app works fine without ERDs.

#### Production Commands

```bash
# Apply migrations without prompts (uses .env.production)
npm run db:migrate:prod

# Generate production client (uses .env.production)
npm run db:generate:prod

# Seed production database via unified seed (prisma/seed.ts)
npm run seed:prod
```

#### PM2 Process Management Commands

**🆕 NEW**: Complete PM2 integration for robust production deployment!

```bash
# PM2 Process Management
npm run pm2:start      # Start application with PM2
npm run pm2:stop       # Stop all PM2 processes
npm run pm2:restart    # Restart all processes
npm run pm2:reload     # Reload processes (zero-downtime)
npm run pm2:logs       # View application logs
npm run pm2:status     # Show process status
npm run pm2:monit      # Open PM2 monitor dashboard
npm run pm2:save       # Save process list for startup
npm run pm2:delete     # Delete all PM2 processes

# Deployment Commands
npm run prod:deploy          # Build and restart PM2
npm run prod:full-deploy     # Migrate, build, and restart PM2
```

**PM2 Setup via Wizard:**
```bash
./scripts/setup-wizard.sh
# Navigate to: System Tools → Install PM2 Process Manager
# Then: System Tools → Setup PM2 Ecosystem
# Finally: System Tools → Configure PM2 Startup (for auto-start on boot)
```

**PM2 Features:**
- 🔄 **Auto-restart** on crashes
- 📊 **Process monitoring** and health checks
- 📝 **Log management** with rotation
- ⚡ **Zero-downtime** deployments
- 🚀 **Cluster mode** for scaling
- 🔧 **System startup** integration

### Code Quality

```bash
# Lint code
npm run lint

# Type check
npm run type-check

# Build for production
npm run build
```

---

## 🧰 Automation Scripts

The project includes several automation scripts to make setup and deployment easier:

### Setup Wizard (Recommended)

```bash
./scripts/setup-wizard.sh
```

Interactive menu-driven setup for beginners. Handles everything from Node.js installation to complete application deployment.

### Quick Setup Examples

```bash
./scripts/quick-setup-examples.sh
```

**🆕 NEW**: Interactive guide with common setup scenarios:
- 🔧 Development Setup (Local SQLite)
- 🚀 Production Setup (PostgreSQL + PM2)
- 📦 PM2 Only Setup (Existing App)
- 🔄 Migration from Dev to Prod
- 🛠️ System Tools & Maintenance
- 📚 Manual Commands Reference

### PostgreSQL Scripts

```bash
sudo ./scripts/setup-postgresql.sh       # Complete PostgreSQL setup with all features
sudo ./scripts/quick-postgresql-setup.sh # Fast PostgreSQL installation and configuration
```

### Deployment Scripts

```bash
./scripts/deploy-production.js           # Automated production deployment
```

Features:

- Beginner-friendly with step-by-step guidance
- Error handling for existing installations
- Cross-platform compatibility (Ubuntu/CentOS)
- Re-runnable without breaking existing setups
- Built-in testing and validation

---

## 🚀 Deployment

### PostgreSQL Production Setup

#### Option 1: Automated Setup (Recommended)

Use our comprehensive PostgreSQL setup script:

```bash
# On your production Ubuntu server
git clone <repository-url>
cd afct
chmod +x scripts/*.sh

# Run the complete PostgreSQL setup
sudo ./scripts/setup-postgresql.sh
```

This will automatically:

- ✅ Install PostgreSQL with optimal configuration
- ✅ Create secure database and user
- ✅ Configure authentication and firewall
- ✅ Install Node.js and PM2
- ✅ Create production environment file
- ✅ Set up automated backups

#### Option 2: Quick Setup

For a faster setup process:

```bash
# Quick PostgreSQL installation and configuration
sudo ./scripts/quick-postgresql-setup.sh
```

#### Option 3: Manual Setup

Follow the detailed [PostgreSQL Ubuntu Setup Guide](docs/postgresql-ubuntu-setup.md)

### Application Deployment

After PostgreSQL is set up, deploy your application:

```bash
# Install dependencies
npm ci --only=production

# Switch to production schema
cp prisma/schema.production.prisma prisma/schema.prisma

# Generate Prisma client
npx prisma generate

# Build application
npm run build

# Apply database migrations
npx prisma migrate deploy

# Seed database (optional)
npm run seed

# Start with PM2
pm2 start npm --name "afct-dashboard" -- start
pm2 save
```

### Troubleshooting Database Connections

If you encounter database connection issues:

```bash
# Use the setup wizard connection test
./scripts/setup-wizard.sh  # Choose option 9: Test Database Connection
```

This script will:

- ✅ Test PostgreSQL service status
- ✅ Verify port connectivity
- ✅ Test authentication
- ✅ Check Prisma compatibility
- ✅ Handle special characters in passwords

### Legacy Deployment Options

#### Cross-Platform Deployment Script

For existing setups, you can still use the original deployment script:

```bash
# Cross-platform deployment script
npm run deploy:production

# Or run the script directly
node scripts/deploy-production.js
```

#### SQLite (For Simple Deployments)

1. **Build the application**:

   ```bash
   npm run build
   ```

2. **Deploy files** to your server (ensure `prisma/` folder is included)

3. **Run production setup** on the server:

   ```bash
   # Install dependencies (production only)
   npm ci --only=production

   # Generate Prisma client
   npx prisma generate

   # Apply migrations
   npx prisma migrate deploy

   # Start the application
   npm start
   ```

### Deployment Script Features

The automated deployment script (`scripts/deploy-production.js`) handles:

- ✅ Environment validation
- ✅ Database schema switching (SQLite → PostgreSQL)
- ✅ Production build generation
- ✅ Database migration and seeding
- ✅ Error handling and rollback
- ✅ Cross-platform compatibility

### Environment-Specific Configurations

#### Development (SQLite)

```env
DATABASE_URL="file:./dev.db"
```

#### Production (PostgreSQL)

```env
DATABASE_URL="postgresql://username:password@host:port/database"
```

### Manual Production Deployment

If you prefer manual deployment:

```bash
# 1. Install production dependencies
npm ci --only=production

# 2. Switch to production schema
cp prisma/schema.production.prisma prisma/schema.prisma

# 3. Generate production client
npx prisma generate

# 4. Build application
npm run build

# 5. Apply migrations
npx prisma migrate deploy

# 6. Seed database (optional)
npm run seed

# 7. Start application
npm start
```

### Server Requirements

- **Node.js 18+**
- **PostgreSQL 12+** (for production)
- **2GB+ RAM** (recommended)
- **Linux/Windows/macOS** compatible

---

## 📂 Project Structure

```
src/
  app/              # Next.js app router
    api/            # API routes (server-side)
      auth/         # Authentication endpoints
      comments/     # Comments management
      courses/      # Course management
      problems/     # Problem management
      submissions/  # Assignment submissions
      users/        # User management
    dashboard/      # Dashboard pages
      admin/        # Admin-only pages
      faculty/      # Faculty pages
      student/      # Student pages
    login/          # Authentication pages
  components/       # Reusable UI components
    dialogs/        # Modal dialogs
    forms/          # Form components
    ui/             # Base UI components (shadcn/ui)
  hooks/            # Custom React hooks
  lib/              # Utilities and configurations
    prisma-config.ts # Database configuration
    auth.ts         # Authentication helpers
  schemas/          # Validation schemas
  types/            # TypeScript type definitions

prisma/
  schema.prisma           # Development schema (SQLite)
  schema.production.prisma # Production schema (PostgreSQL)
  migrations/             # Database migrations
  seed.ts                # Database seeding script

scripts/
  setup-wizard.sh         # 🎯 Interactive setup wizard (recommended for beginners)
  setup-postgresql.sh     # Complete PostgreSQL installation & setup
  quick-postgresql-setup.sh # Quick PostgreSQL setup
  deploy-production.js    # Automated application deployment script

public/
  uploads/               # User uploaded files
```

---

## 👥 User Roles & Permissions

### 🔧 Admin

- Full system access
- User management (create, edit, delete)
- Course and assignment oversight
- System configuration

### 👨‍🏫 Faculty

- Create and manage courses
- Create assignments and problems
- View all student submissions
- Grade assignments
- Manage course roster

### 👨‍🎓 TA (Teaching Assistant)

- Assist with course management
- View and grade submissions
- Help with problem management
- Limited user access

### 🎓 Student

- Enroll in courses
- View assignments
- Submit solutions
- Track grades and progress

---

## 🛠️ Troubleshooting

### Common Issues

#### Prisma Client Not Generated

```bash
# Solution
npx prisma generate
npm run dev
```

#### Migration Errors

```bash
# Reset and retry
npx prisma migrate reset
npx prisma migrate dev
```

#### Database Connection Issues

**🆕 Use automated testing first:**

```bash
# Quick database connection test
npm run db:test              # Development (SQLite)
npm run db:test:prod         # Production (PostgreSQL)

# Or use the troubleshooting wizard
./scripts/setup-wizard.sh    # Choose option 14
```

**Manual troubleshooting:**

```bash
# Check your DATABASE_URL in .env.local
# Ensure database server is running
# Verify credentials and network access

# For PostgreSQL specifically:
sudo systemctl status postgresql  # Check service status
sudo -u postgres psql -l          # List databases
sudo -u postgres psql -c "\du"    # List users
```

#### Build Errors

```bash
# Clear Next.js cache
rm -rf .next
npm run build
```

#### File Upload Issues

```bash
# Check UPLOAD_DIR permissions
# Verify MAX_FILE_SIZE setting
# Ensure public/uploads directory exists
```

#### ERD Generation Issues

If you see Chrome/Chromium errors during `npm install`:

```bash
# This is normal and won't affect functionality
# ERD generation is optional - the app works fine without it

# To fix ERD generation:
sudo apt install chromium-browser  # Ubuntu
# or download Chrome manually

# Then generate ERD:
npm run db:generate:with-erd
```

**Solution**: ERDs are development-only features. Use `npm run db:generate:safe` for safe installation.

### Platform-Specific Issues

#### Windows PowerShell Execution Policy

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Unrestricted
```

#### macOS/Linux File Permissions

```bash
# Fix upload directory permissions
chmod 755 public/uploads
```

### Performance Tips

1. **Database Optimization**:
   - Use connection pooling for PostgreSQL
   - Index frequently queried fields
   - Implement pagination for large datasets

2. **File Management**:
   - Consider cloud storage for large files
   - Implement file cleanup scripts
   - Use CDN for static assets

3. **Caching**:
   - Enable Next.js caching
   - Use Redis for session storage
   - Implement API response caching

---

## 🔧 Advanced Configuration

### Custom Environment Variables

Add custom variables to your environment files:

```env
# Custom app settings
APP_NAME="AFCT Dashboard"
APP_VERSION="1.0.0"
ADMIN_EMAIL="admin@yourschool.edu"

# File upload limits
MAX_UPLOAD_SIZE="10485760"  # 10MB
ALLOWED_FILE_TYPES="pdf,doc,docx,txt,jpg,png"

# Email configuration (optional)
SMTP_HOST=""
SMTP_PORT=""
SMTP_USER=""
SMTP_PASS=""
```

### Database Configuration

#### PostgreSQL Connection Pooling

```env
DATABASE_URL="postgresql://user:pass@host:port/db?connection_limit=20&pool_timeout=20"
```

#### SQLite Optimizations

```env
DATABASE_URL="file:./dev.db?connection_limit=1"
```

### Security Considerations

1. **Environment Variables**:
   - Never commit `.env.local` or `.env.production`
   - Use strong, unique JWT secrets
   - Rotate secrets regularly

2. **File Uploads**:
   - Validate file types and sizes
   - Scan uploads for malware
   - Store uploads outside web root

3. **Database Security**:
   - Use connection pooling
   - Enable SSL for PostgreSQL
   - Regular security updates

---

## 📜 Automated Scripts Reference

The AFCT Dashboard includes several automated scripts to simplify setup and deployment:

### Setup and Installation Scripts

| Script                      | Purpose                                            | Usage                                      |
| --------------------------- | -------------------------------------------------- | ------------------------------------------ |
| `setup-wizard.sh`           | 🎯 **Interactive setup wizard (recommended)**      | `./scripts/setup-wizard.sh`                |
| `setup-postgresql.sh`       | Complete PostgreSQL installation and configuration | `sudo ./scripts/setup-postgresql.sh`       |
| `quick-postgresql-setup.sh` | Fast PostgreSQL setup for testing                  | `sudo ./scripts/quick-postgresql-setup.sh` |

### Application Deployment Scripts

| Script                 | Purpose                               | Usage                       |
| ---------------------- | ------------------------------------- | --------------------------- |
| `deploy-production.js` | Cross-platform application deployment | `npm run deploy:production` |

### Script Features

- ✅ **Beginner-friendly** with step-by-step guidance
- ✅ **Cross-platform compatibility** (Windows, macOS, Linux)
- ✅ **Error handling and validation** for existing installations
- ✅ **Interactive prompts for configuration**
- ✅ **Automatic backup creation**
- ✅ **Security best practices**
- ✅ **Comprehensive logging**
- ✅ **Re-runnable** without breaking existing setups

### Quick Commands Summary

```bash
# Make all scripts executable
chmod +x scripts/*.sh

# Complete production setup
sudo ./scripts/setup-postgresql.sh
npm run deploy:production

# Quick development setup
sudo ./scripts/quick-postgresql-setup.sh
npm run dev

# Troubleshooting
./scripts/setup-wizard.sh  # Menu option 9: Test Database Connection
```

---

## �📚 Learning Resources

### Next.js

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
- [Next.js Examples](https://github.com/vercel/next.js/tree/canary/examples)

### Prisma

- [Prisma Documentation](https://www.prisma.io/docs)
- [Prisma Schema Reference](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference)
- [Database Migrations](https://www.prisma.io/docs/concepts/components/prisma-migrate)

### TypeScript

- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [TypeScript with Next.js](https://nextjs.org/docs/pages/building-your-application/configuring/typescript)

### UI Components

- [shadcn/ui](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Radix UI](https://www.radix-ui.com/)

---

## 🤝 Contributing

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes** and add tests
4. **Commit changes**: `git commit -m 'Add amazing feature'`
5. **Push to branch**: `git push origin feature/amazing-feature`
6. **Open a Pull Request**

### Development Standards

- Use TypeScript for all new code
- Follow ESLint configuration
- Add tests for new features
- Update documentation
- Follow semantic commit messages

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🆘 Support

Need help? Here are your options:

1. **Check the troubleshooting section** above
2. **Search existing issues** in the repository
3. **Create a new issue** with detailed information
4. **Contact the development team**

### Issue Template

When reporting bugs, please include:

- Operating system and version
- Node.js version
- Error messages and logs
- Steps to reproduce
- Expected vs actual behavior

---

## 🎯 Roadmap

### Upcoming Features

- [ ] Email notifications
- [ ] Advanced analytics dashboard
- [ ] Mobile responsive design improvements
- [ ] API rate limiting
- [ ] Enhanced file management
- [ ] Integration with external learning systems
- [ ] Advanced grading features
- [ ] Student collaboration tools

### Version History

- **v1.0.0** - Initial release with core functionality
- **v1.1.0** - Added comment system and improved UI
- **v1.2.0** - Cross-platform deployment support
- **v2.0.0** - (Planned) Enhanced analytics and mobile support

---

_Last updated: January 2025_
