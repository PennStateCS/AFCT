# 🐘 PostgreSQL Installation and Setup Guide for Ubuntu

This guide walks you through installing PostgreSQL on Ubuntu and configuring it for production deployment of the AFCT Dashboard.

## 📋 Prerequisites

- Ubuntu 20.04 LTS or newer
- Root or sudo access
- Basic knowledge of command line

## 🚀 Step 1: Update System Packages

```bash
# Update package lists
sudo apt update

# Upgrade existing packages
sudo apt upgrade -y
```

## 🐘 Step 2: Install PostgreSQL

### Option A: Install from Ubuntu Repository (Recommended for most users)

```bash
# Install PostgreSQL and additional utilities
sudo apt install postgresql postgresql-contrib -y
```

### Option B: Install Latest Version from Official PostgreSQL Repository

```bash
# Import PostgreSQL signing key
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -

# Add PostgreSQL APT repository
echo "deb http://apt.postgresql.org/pub/repos/apt/ $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list

# Update package list
sudo apt update

# Install PostgreSQL (replace 15 with desired version)
sudo apt install postgresql-15 postgresql-contrib-15 -y
```

## 🔧 Step 3: Initial PostgreSQL Configuration

### Start and Enable PostgreSQL Service

```bash
# Start PostgreSQL service
sudo systemctl start postgresql

# Enable PostgreSQL to start on boot
sudo systemctl enable postgresql

# Check service status
sudo systemctl status postgresql
```

### Set Password for PostgreSQL User

```bash
# Switch to postgres user
sudo -i -u postgres

# Access PostgreSQL prompt
psql

# Set password for postgres user (replace 'your_secure_password' with a strong password)
\password postgres
# Enter your password twice

# Exit PostgreSQL prompt
\q

# Exit postgres user session
exit
```

## 🗄️ Step 4: Create Database and User for AFCT Dashboard

### Create Database User

```bash
# Switch to postgres user
sudo -i -u postgres

# Create a new user for your application
createuser --interactive --pwprompt afct_user

# Follow the prompts:
# Enter password for new role: [enter a secure password]
# Enter it again: [repeat the password]
# Shall the new role be a superuser? (y/n) n
# Shall the new role be allowed to create databases? (y/n) y
# Shall the new role be allowed to create more new roles? (y/n) n
```

### Create Database

```bash
# Create database for AFCT Dashboard
createdb -O afct_user afct_production

# Exit postgres user session
exit
```

### Alternative: Create User and Database via SQL

```bash
# Switch to postgres user and access PostgreSQL
sudo -i -u postgres psql

# Create user
CREATE USER afct_user WITH PASSWORD 'your_secure_password';

# Create database
CREATE DATABASE afct_production OWNER afct_user;

# Grant privileges
GRANT ALL PRIVILEGES ON DATABASE afct_production TO afct_user;

# Exit
\q
exit
```

## 🔒 Step 5: Configure PostgreSQL Security

### Edit PostgreSQL Configuration

```bash
# Find PostgreSQL version and config location
sudo -u postgres psql -c "SHOW config_file;"

# Common locations:
# /etc/postgresql/15/main/postgresql.conf
# /etc/postgresql/14/main/postgresql.conf
# /etc/postgresql/13/main/postgresql.conf

# Edit main configuration file (replace 15 with your version)
sudo nano /etc/postgresql/15/main/postgresql.conf
```

### Key Configuration Settings

Add or modify these settings in `postgresql.conf`:

```conf
# Connection settings
listen_addresses = 'localhost'          # For local connections only
# listen_addresses = '*'                 # For remote connections (less secure)

# Memory settings (adjust based on your server's RAM)
shared_buffers = 256MB                   # 25% of RAM is a good starting point
effective_cache_size = 1GB               # 75% of available RAM

# Connection limits
max_connections = 100                    # Adjust based on your needs

# Logging (helpful for debugging)
log_statement = 'all'                    # Log all SQL statements (disable in production)
log_destination = 'stderr'
logging_collector = on
log_directory = 'log'
log_filename = 'postgresql-%Y-%m-%d_%H%M%S.log'
```

### Configure Client Authentication

```bash
# Edit authentication configuration (replace 15 with your version)
sudo nano /etc/postgresql/15/main/pg_hba.confs
```

Add or modify these lines in `pg_hba.conf`:

```conf
# Local connections
local   all             postgres                                peer
local   all             afct_user                               md5
local   afct_production afct_user                               md5

# IPv4 local connections:
host    afct_production afct_user       127.0.0.1/32            md5
host    afct_production afct_user       ::1/128                 md5

# For remote connections (if needed - be careful with security)
# host    afct_production afct_user       0.0.0.0/0               md5
```

### Restart PostgreSQL

```bash
# Restart to apply configuration changes
sudo systemctl restart postgresql

# Verify service is running
sudo systemctl restart postgresql
```

## 🧪 Step 6: Test Database Connection

### Test Local Connection

```bash
# Test connection with new user
psql -h localhost -U afct_user -d afct_production

# You should see a prompt like:
# afct_production=>

# Test basic operations
\dt  # List tables (should be empty initially)
\q   # Exit
```

### Test from Your Application Directory

```bash
# Navigate to your AFCT project directory
cd /path/to/your/afct

# Test connection with environment variable
DATABASE_URL="postgresql://afct_user:your_password@localhost:5432/afct_production" npx prisma db pull
```

## 🚀 Step 7: Production Server Setup for AFCT Dashboard

### Install Node.js

```bash
# Install Node.js 18 LTS
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### Install Process Manager (PM2)

```bash
# Install PM2 globally
sudo npm install -g pm2

# Configure PM2 to start on system boot
pm2 startup
# Follow the command it provides (usually involves running a command with sudo)
```

### Prepare Application Directory

```bash
# Create application directory
sudo mkdir -p /var/www/afct
sudo chown $USER:$USER /var/www/afct

# Navigate to application directory
cd /var/www/afct
```

### Deploy Your Application

```bash
# Clone your repository (or upload your files)
git clone <your-repository-url> .

# Install dependencies
npm ci --only=production

# Create production environment file
cp .env.example .env.production

# Edit production environment
nano .env.production
```

### Configure Production Environment

Edit `.env.production` with your actual values:

```env
# Database Configuration
DATABASE_URL="postgresql://afct_user:your_password@localhost:5432/afct_production"

# JWT Secret (generate a strong secret)
JWT_SECRET="your-production-jwt-secret-key"

# Application Settings
APP_URL="https://yourdomain.com"
NODE_ENV="production"

# File Upload
UPLOAD_DIR="./public/uploads"
MAX_FILE_SIZE="10485760"
```

### Set Up Database Schema

```bash
# Copy production schema
cp prisma/schema.production.prisma prisma/schema.prisma

# Generate Prisma client
npx prisma generate

# Apply database migrations
npx prisma migrate deploy

# Seed database (optional)
npm run seed
```

### Build and Start Application

```bash
# Build the application
npm run build

# Start with PM2
pm2 start npm --name "afct-dashboard" -- start

# Save PM2 configuration
pm2 save

# Check application status
pm2 status
pm2 logs afct-dashboard
```

## 🔒 Step 8: Security Hardening

### Firewall Configuration

```bash
# Install UFW if not already installed
sudo apt install ufw -y

# Allow SSH (if using remote access)
sudo ufw allow ssh

# Allow HTTP and HTTPS (if using web server)
sudo ufw allow 80
sudo ufw allow 443

# Allow PostgreSQL only from localhost (default port 5432)
sudo ufw allow from 127.0.0.1 to any port 5432

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

### PostgreSQL Security

```bash
# Secure PostgreSQL installation
sudo -u postgres psql

# Remove default database (optional)
DROP DATABASE IF EXISTS template0;

# Exit
\q
```

### File Permissions

```bash
# Set proper permissions for application files
sudo chown -R $USER:$USER /var/www/afct
chmod -R 755 /var/www/afct

# Secure environment file
chmod 600 /var/www/afct/.env.production

# Create uploads directory with proper permissions
mkdir -p /var/www/afct/public/uploads
chmod 755 /var/www/afct/public/uploads
```

## 🌐 Step 9: Web Server Configuration (Optional)

### Install and Configure Nginx

```bash
# Install Nginx
sudo apt install nginx -y

# Create Nginx configuration for your app
sudo nano /etc/nginx/sites-available/afct-dashboard
```

Add this configuration:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site:

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/afct-dashboard /etc/nginx/sites-enabled/

# Test Nginx configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx

# Enable Nginx to start on boot
sudo systemctl enable nginx
```

## 🔐 Step 10: SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtain SSL certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Test automatic renewal
sudo certbot renew --dry-run
```

## 📊 Step 11: Monitoring and Maintenance

### Set Up Log Rotation

```bash
# Create logrotate configuration
sudo nano /etc/logrotate.d/afct-dashboard
```

Add this configuration:

```conf
/home/$USER/.pm2/logs/*.log {
    daily
    missingok
    rotate 7
    compress
    notifempty
    create 0644 $USER $USER
    postrotate
        pm2 reloadLogs
    endscript
}
```

### Database Backup Script

```bash
# Create backup directory
sudo mkdir -p /var/backups/postgresql

# Create backup script
sudo nano /usr/local/bin/backup-afct-db.sh
```

Add this script:

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/postgresql"
DB_NAME="afct_production"
DB_USER="afct_user"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup
pg_dump -h localhost -U $DB_USER $DB_NAME > $BACKUP_DIR/afct_backup_$DATE.sql

# Keep only last 7 days of backups
find $BACKUP_DIR -name "afct_backup_*.sql" -type f -mtime +7 -delete

echo "Backup completed: afct_backup_$DATE.sql"
```

Make it executable and set up cron job:

```bash
# Make script executable
sudo chmod +x /usr/local/bin/backup-afct-db.sh

# Add to crontab (daily backup at 2 AM)
sudo crontab -e

# Add this line:
0 2 * * * /usr/local/bin/backup-afct-db.sh
```

## ✅ Step 12: Verification Checklist

### Database Verification

```bash
# Test database connection
psql -h localhost -U afct_user -d afct_production -c "SELECT version();"

# Check database size
psql -h localhost -U afct_user -d afct_production -c "SELECT pg_size_pretty(pg_database_size('afct_production'));"
```

### Application Verification

```bash
# Check PM2 status
pm2 status

# Check application logs
pm2 logs afct-dashboard

# Test application endpoint
curl http://localhost:3000

# If using Nginx, test external access
curl http://yourdomain.com
```

### Security Verification

```bash
# Check firewall status
sudo ufw status

# Check PostgreSQL is only listening locally
sudo netstat -tlnp | grep 5432

# Check file permissions
ls -la /var/www/afct/.env.production
```

## 🚨 Troubleshooting Common Issues

### PostgreSQL Connection Issues

```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Check PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-*.log

# Test connection with verbose output
psql -h localhost -U afct_user -d afct_production -v ON_ERROR_VERBOSE=on
```

### Application Issues

```bash
# Check PM2 logs
pm2 logs afct-dashboard --lines 50

# Restart application
pm2 restart afct-dashboard

# Check Node.js processes
ps aux | grep node
```

### Performance Issues

```bash
# Check PostgreSQL performance
sudo -u postgres psql -c "SELECT * FROM pg_stat_activity;"

# Check system resources
htop
df -h
free -h
```

## 📚 Additional Resources

- [PostgreSQL Official Documentation](https://www.postgresql.org/docs/)
- [PM2 Documentation](https://pm2.keymetrics.io/docs/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)

---

_This guide provides a comprehensive setup for PostgreSQL and production deployment. Adjust configurations based on your specific requirements and security policies._
