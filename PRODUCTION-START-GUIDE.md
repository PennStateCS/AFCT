# Quick Production Server Start Guide

## Current Status
Your production database reset encountered an issue because:
1. The wrong schema file was being used (SQLite instead of PostgreSQL)
2. The database migrations need to use the production schema explicitly

## ✅ **FIXED**: Database Reset Issues
I've updated the setup wizard to properly handle production database resets using the correct PostgreSQL schema.

## 🚀 **How to Start Production Server**

### Step 1: Ensure Database is Running
```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# If not running, start it
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### Step 2: Test Database Connection
```bash
# Test production database connection
npm run db:test:prod
```

### Step 3: Build and Start Production Server

**Option A: Using Setup Wizard (Recommended)**
```bash
./scripts/setup-wizard.sh
# Choose option 8: Deploy Application
```

**Option B: Manual Start**
```bash
# Build the application
npm run build

# Start production server
npm start
```

**Option C: Using PM2 (Best for Production)**
```bash
# Start with PM2
pm2 start npm --name afct-dashboard -- start

# Save PM2 configuration
pm2 save

# Enable startup on boot
pm2 startup
```

## 🔧 **If You Need to Reset Production Database Again**

The reset function is now fixed! You can safely run:
```bash
./scripts/setup-wizard.sh
# Choose option 11: Reset Database (Production)
```

It will now:
- ✅ Use the correct PostgreSQL schema
- ✅ Properly handle environment variables
- ✅ Apply migrations correctly
- ✅ Provide better error messages

## 🔍 **Troubleshooting Commands**

```bash
# Check system status
./scripts/setup-wizard.sh
# Choose option 13: View System Status

# Database troubleshooting
./scripts/setup-wizard.sh  
# Choose option 14: Database Troubleshooting

# Test specific database
npm run db:test        # Development (SQLite)
npm run db:test:prod   # Production (PostgreSQL)
```

## 📋 **Available NPM Scripts**

```bash
# Database operations
npm run db:generate:safe       # Safe Prisma generation
npm run db:migrate:prod        # Apply production migrations
npm run db:test:prod          # Test production database

# Application operations  
npm run build                 # Build for production
npm start                     # Start production server
npm run dev                   # Start development server
```

## 🌐 **Access Your Application**

Once running, visit:
- **Local**: http://localhost:3000
- **Network**: http://your-server-ip:3000

Default credentials:
- **Admin**: admin@example.com / password123
- **Faculty**: prof1@example.com / password123
- **Student**: student1@example.com / password123

## ⚡ **Next Steps**

1. **Start PostgreSQL**: `sudo systemctl start postgresql`
2. **Test connection**: `npm run db:test:prod`
3. **Start server**: `npm start` or use the setup wizard option 8
4. **Access application**: http://localhost:3000

The production database reset issue has been resolved! 🎉
