# PM2 & dotenv-cli Setup Guide

## Overview
The AFCT Dashboard setup wizard now includes comprehensive PM2 process management and dotenv-cli integration for robust production deployment and environment handling.

## Features Implemented

### 🚀 PM2 Process Manager
- **Global Installation**: Automatic PM2 installation with logrotate module
- **Ecosystem Configuration**: Smart ecosystem.config.js generation with:
  - Configurable instances (0=auto-scaling)
  - Memory management and restart policies
  - Environment-specific settings (dev/staging/prod)
  - Comprehensive logging setup
  - Watch mode for development
  - Cluster mode support

### 🔧 dotenv-cli Environment Management
- **Multiple Installation Options**:
  - Development dependency (recommended)
  - Global installation
  - Production dependency
- **Safe Environment Loading**: Prevents conflicts between .env files
- **Cross-platform Support**: Works on Windows, Linux, macOS

### 📋 Menu Structure

#### System Tools Menu (Option 4)
```
1. System Health Check
2. View System Status
3. Install Node.js
4. Install PostgreSQL
5. Install Project Dependencies
6. Install PM2 Process Manager
7. Install dotenv-cli
8. Setup PM2 Ecosystem
9. Configure PM2 Startup
10. Manage PM2 Processes
```

#### Production Setup Menu (Option 2)
```
1. Complete Production Setup (All-in-One)
   ├── Node.js installation
   ├── PostgreSQL installation
   ├── Project dependencies
   ├── PM2 installation
   ├── dotenv-cli installation
   ├── Database setup
   ├── PM2 ecosystem configuration
   └── Application build

4. Install PM2 Process Manager
5. Setup PM2 Ecosystem
7. Configure PM2 Startup
8. Manage PM2 Processes
```

## Usage Examples

### Quick Production Setup
```bash
# Run the setup wizard
bash scripts/setup-wizard.sh

# Select: 2 (Production Setup) → 1 (Complete Production Setup)
# This will automatically:
# - Install all dependencies
# - Configure PM2 ecosystem
# - Setup production database
# - Build and prepare the application
```

### Manual PM2 Management
```bash
# Start application
pm2 start ecosystem.config.js

# Monitor processes
pm2 monit

# View logs
pm2 logs

# Restart application
pm2 restart all

# Save configuration for startup
pm2 save
```

### dotenv-cli Usage
```bash
# Run with production environment
npx dotenv -e .env.production -- npm start

# Run database migrations with production env
npx dotenv -e .env.production -- prisma migrate deploy

# Multiple environment files
npx dotenv -e .env -e .env.local -- npm run dev
```

## Generated PM2 Ecosystem Configuration

The setup wizard creates a comprehensive `ecosystem.config.js` with:

```javascript
module.exports = {
  apps: [
    {
      name: 'afct-dashboard',
      script: 'npm',
      args: 'start',
      instances: 0, // Auto-scaling
      exec_mode: 'cluster',
      
      // Environment
      env_file: '.env.production',
      
      // Memory & Performance
      max_memory_restart: '512M',
      
      // Restart Policy
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      
      // Logging
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      
      // Monitoring
      pmx: true,
      
      // Environment Variables
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
```

## Process Management Menu

The PM2 management interface provides:

1. **View Process Status** - Shows all running processes
2. **Start Application** - Starts using ecosystem.config.js
3. **Stop Application** - Gracefully stops all processes
4. **Restart Application** - Restarts all processes
5. **View Logs** - Shows recent application logs
6. **Monitor Processes** - Opens PM2 monitor dashboard
7. **Save Process List** - Saves for automatic startup
8. **Delete All Processes** - Removes all PM2 processes

## Startup Configuration

PM2 can be configured to automatically start your application on system boot:

```bash
# Configure PM2 startup (requires root)
sudo bash scripts/setup-wizard.sh
# Select: 4 (System Tools) → 9 (Configure PM2 Startup)

# This will:
# 1. Generate startup script for your system
# 2. Configure PM2 to start on boot
# 3. Save current process list
```

## Environment Safety

The setup ensures safe environment handling:

- **Development**: Uses `.env.local` or `.env`
- **Production**: Uses `.env.production`
- **No Conflicts**: dotenv-cli prevents environment variable conflicts
- **URL Encoding**: Handles special characters in database URLs
- **Schema Switching**: Automatically uses correct Prisma schema

## Package.json Integration

The following scripts are available:

```json
{
  "scripts": {
    "start": "cross-env NODE_ENV=production next start",
    "start:prod": "cross-env NODE_ENV=production dotenv -e .env.production -- next start",
    "build:prod": "cross-env NODE_ENV=production next build",
    "seed:prod": "cross-env NODE_ENV=production dotenv -e .env.production -- prisma db seed --schema=prisma/schema.production.prisma",
    "db:migrate:prod": "cross-env NODE_ENV=production dotenv -e .env.production -- prisma migrate deploy --schema=prisma/schema.production.prisma"
  }
}
```

## Troubleshooting

### PM2 Issues
```bash
# Check PM2 status
pm2 status

# View detailed logs
pm2 logs --lines 100

# Restart with fresh configuration
pm2 delete all
pm2 start ecosystem.config.js

# Check PM2 startup configuration
pm2 startup
```

### Environment Issues
```bash
# Test environment loading
npx dotenv -e .env.production -- node -e "console.log(process.env.DATABASE_URL)"

# Check for environment conflicts
bash scripts/setup-wizard.sh
# Select: 2 (Production) → 13 (Environment Conflict Detection)
```

### Database Connection Issues
```bash
# Test production database connection
npm run db:test:prod

# Check database URL encoding
# Ensure special characters are URL-encoded in .env.production
```

## Next Steps

1. **Setup Development Environment**: Use Quick Setup (Dev) option
2. **Configure Production**: Use Complete Production Setup option
3. **Enable Startup**: Configure PM2 startup for automatic restarts
4. **Monitor**: Use PM2 monitoring tools for performance tracking
5. **Scale**: Adjust instances in ecosystem.config.js as needed

## Files Created/Modified

- `ecosystem.config.js` - PM2 application configuration
- `logs/` - Directory for application logs
- `.env.production` - Production environment variables
- Package.json scripts updated for production deployment

The setup wizard provides a complete, production-ready deployment solution with robust process management and environment handling.
