# 🚀 AFCT Dashboard Deployment Checklist

Use this checklist to ensure a smooth deployment process.

## 🎯 Easy Setup with Setup Wizard (Recommended)

**Perfect for beginners!** Skip the manual checklist and use our automated setup wizard:

```bash
# Make the wizard executable
chmod +x scripts/setup-wizard.sh

# Run the interactive setup wizard
./scripts/setup-wizard.sh
```

### What the Wizard Does:

- ✅ **Complete Production Setup**: Handles Node.js, PostgreSQL, database, and application
- ✅ **System Health Checks**: Verifies requirements and troubleshoots issues
- ✅ **Graceful Error Handling**: Manages existing installations and configurations
- ✅ **Built-in Testing**: Validates database connections and application deployment
- ✅ **User-Friendly Interface**: Step-by-step guidance with clear instructions

**The wizard eliminates most manual steps below and is recommended for all users, especially beginners.**

---

## 📋 Manual Deployment Checklist (Advanced Users)

For advanced users who prefer manual control:

### Environment Setup

- [ ] Production environment variables configured in `.env.production`
- [ ] Database URL points to production PostgreSQL instance
- [ ] JWT_SECRET is strong and unique for production
- [ ] File upload directory permissions set correctly
- [ ] All sensitive data removed from code

### Database

- [ ] PostgreSQL installed (use `sudo ./scripts/setup-postgresql.sh` or setup wizard)
- [ ] Database and user created automatically by setup script
- [ ] Database credentials tested (use setup wizard's connection test or `./scripts/setup-wizard.sh`)
- [ ] Production schema file (`prisma/schema.production.prisma`) up to date
- [ ] Backup system configured by setup script

### Security

- [ ] Strong passwords for all default accounts
- [ ] CORS origins configured correctly
- [ ] File upload restrictions in place
- [ ] Rate limiting configured (if applicable)
- [ ] SSL/TLS certificates configured on server

### Code Quality

- [ ] All tests passing (`npm run lint`)
- [ ] TypeScript compilation successful (`npm run build`)
- [ ] No console.log statements in production code
- [ ] Error handling implemented for all API routes

## 🔄 Deployment Steps

### PostgreSQL Setup (First Time)

#### Option 1: Automated PostgreSQL Setup (Recommended)

```bash
# Make scripts executable
chmod +x scripts/*.sh

# Run complete PostgreSQL installation and configuration
sudo ./scripts/setup-postgresql.sh
```

This script will handle:

- ✅ PostgreSQL installation and security configuration
- ✅ Database and user creation with graceful handling of existing resources
- ✅ Authentication setup
- ✅ Firewall configuration
- ✅ Node.js and PM2 installation
- ✅ Production environment file creation
- ✅ Automated backup setup

**Note**: Both scripts intelligently handle existing databases and users, updating passwords and permissions as needed without failing.

#### Option 2: Quick PostgreSQL Setup

```bash
# For streamlined PostgreSQL setup
sudo ./scripts/quick-postgresql-setup.sh
```

#### Option 3: Database Connection Testing

If you encounter database issues:

```bash
# Test and troubleshoot database connections
./scripts/setup-wizard.sh  # Choose option 9: Test Database Connection
```

### Application Deployment

#### Automated Application Deployment

```bash
# Run the automated application deployment script
npm run deploy:production
```

#### Manual Application Deployment

1. **Install dependencies**:

   ```bash
   npm ci --only=production
   ```

2. **Switch to production schema**:

   ```bash
   cp prisma/schema.production.prisma prisma/schema.prisma
   ```

3. **Generate Prisma client**:

   ```bash
   npx prisma generate
   ```

4. **Build application**:

   ```bash
   npm run build
   ```

5. **Apply database migrations**:

   ```bash
   npx prisma migrate deploy
   ```

6. **Seed database** (first deployment only):

   ```bash
   npm run seed
   ```

7. **Start application**:
   ```bash
   npm start
   ```

## ✅ Post-Deployment Verification

### Application Health

- [ ] Application starts without errors
- [ ] Login page accessible at production URL
- [ ] Database connection working
- [ ] File uploads functioning correctly
- [ ] All user roles can access appropriate features

### Test User Accounts

- [ ] Admin login working (`admin@example.com`)
- [ ] Faculty login working (`prof1@example.com`)
- [ ] TA login working (`ta1@example.com`)
- [ ] Student login working (`student1@example.com`)
- [ ] Default password (`password123`) working

### Core Functionality

- [ ] Course creation and management
- [ ] Assignment creation and submission
- [ ] Comment system working
- [ ] File upload and download
- [ ] User role permissions enforced
- [ ] Grade tracking functional

### Performance

- [ ] Page load times acceptable
- [ ] Database queries performing well
- [ ] File upload/download speeds acceptable
- [ ] Memory usage within acceptable limits

## 🛡️ Security Verification

### Authentication

- [ ] JWT tokens working correctly
- [ ] Session timeouts appropriate
- [ ] Password requirements enforced
- [ ] Unauthorized access properly blocked

### Data Protection

- [ ] User data properly secured
- [ ] File uploads sanitized
- [ ] Database queries use parameterized statements
- [ ] No sensitive data in logs

## 🔧 Troubleshooting Common Issues

### Database Connection Issues

```bash
# Use the setup wizard database test
./scripts/setup-wizard.sh  # Choose option 9: Test Database Connection

# Manual test database connection
npx prisma db pull

# Check migration status
npx prisma migrate status

# If PostgreSQL setup needed
sudo ./scripts/setup-postgresql.sh
```

### PostgreSQL Service Issues

```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Restart PostgreSQL
sudo systemctl restart postgresql

# Check PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-*.log
```

### Build Issues

```bash
# Clear cache and rebuild
rm -rf .next
npm run build
```

### Permission Issues

```bash
# Fix upload directory permissions (Linux/Mac)
chmod 755 public/uploads

# Windows - ensure IIS/service has write permissions
```

### Memory Issues

```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
npm start
```

## 📊 Monitoring Setup

### Log Files

- [ ] Application logs configured
- [ ] Error logs being captured
- [ ] Database logs accessible
- [ ] Log rotation set up

### Health Checks

- [ ] Basic health endpoint working
- [ ] Database health check implemented
- [ ] File system health check working
- [ ] External service connectivity verified

### Alerts (Optional)

- [ ] Error rate monitoring
- [ ] Performance degradation alerts
- [ ] Database connection monitoring
- [ ] Disk space monitoring

## 🔄 Rollback Plan

### If Issues Occur

1. **Stop the application**
2. **Restore from backup** (if database changes were made)
3. **Revert to previous version**
4. **Restart application**
5. **Verify functionality**

### Backup Commands

```bash
# Database backup (PostgreSQL)
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# Application backup
tar -czf app_backup_$(date +%Y%m%d_%H%M%S).tar.gz .
```

## 📞 Emergency Contacts

- **Primary Developer**: [Contact Info]
- **System Administrator**: [Contact Info]
- **Database Administrator**: [Contact Info]
- **Project Manager**: [Contact Info]

---

_Save this checklist and update it as your deployment process evolves._
