# 🚀 PostgreSQL Ubuntu Setup - Quick Reference

A condensed reference for setting up PostgreSQL on Ubuntu for AFCT Dashboard production deployment.

> **⚡ Automated Setup**: Use `./scripts/setup-wizard.sh` → "Complete Production Setup" for fully automated installation. This guide is for manual setup reference.

## ⚡ Quick Installation

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install PostgreSQL
sudo apt install postgresql postgresql-contrib -y

# Start and enable service
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

## 🔑 Database Setup

```bash
# Switch to postgres user
sudo -i -u postgres

# Set postgres password
psql -c "\password postgres"

# Create application user
createuser --interactive --pwprompt afct_user
# Choose: no superuser, yes create databases, no create roles

# Create database
createdb -O afct_user afct_production

# Test connection
psql -h localhost -U afct_user -d afct_production
```

## ⚙️ Essential Configuration

### PostgreSQL Config (`/etc/postgresql/15/main/postgresql.conf`)

```conf
listen_addresses = 'localhost'
shared_buffers = 256MB
effective_cache_size = 1GB
max_connections = 100
```

### Authentication Config (`/etc/postgresql/15/main/pg_hba.conf`)

```conf
local   afct_production afct_user                               md5
host    afct_production afct_user       127.0.0.1/32            md5
```

### Restart PostgreSQL

```bash
sudo systemctl restart postgresql
```

## 🚀 Application Deployment

### Node.js Installation

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

### Application Setup

```bash
# Create app directory
sudo mkdir -p /var/www/afct
sudo chown $USER:$USER /var/www/afct
cd /var/www/afct

# Deploy code (example with git)
git clone <your-repo> .
npm ci --only=production

# Configure environment
cp .env.example .env.production
nano .env.production
```

### Environment Configuration (`.env.production`)

```env
DATABASE_URL="postgresql://afct_user:password@localhost:5432/afct_production"
JWT_SECRET="your-production-secret"
NODE_ENV="production"
APP_URL="https://yourdomain.com"
```

### Database Migration

```bash
cp prisma/schema.production.prisma prisma/schema.prisma
npx prisma generate
npx prisma migrate deploy
npm run seed  # optional
```

### Start Application

```bash
npm run build
pm2 start npm --name "afct-dashboard" -- start
pm2 save
pm2 startup  # follow the command it provides
```

## 🔒 Security Essentials

### Firewall

```bash
sudo ufw allow ssh
sudo ufw allow 80,443/tcp
sudo ufw allow from 127.0.0.1 to any port 5432
sudo ufw enable
```

### File Permissions

```bash
chmod 600 /var/www/afct/.env.production
chmod 755 /var/www/afct/public/uploads
```

## 🌐 Nginx Setup (Optional)

```bash
# Install
sudo apt install nginx -y

# Configure
sudo nano /etc/nginx/sites-available/afct-dashboard
```

Basic Nginx config:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/afct-dashboard /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 🔐 SSL Certificate

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d yourdomain.com
```

## 📊 Monitoring Commands

### Check Services

```bash
sudo systemctl status postgresql
pm2 status
sudo systemctl status nginx  # if using nginx
```

### View Logs

```bash
pm2 logs afct-dashboard
sudo tail -f /var/log/postgresql/postgresql-*.log
sudo tail -f /var/log/nginx/error.log  # if using nginx
```

### Database Operations

```bash
# Connect to database
psql -h localhost -U afct_user -d afct_production

# Backup database
pg_dump -h localhost -U afct_user afct_production > backup.sql

# Restore database
psql -h localhost -U afct_user -d afct_production < backup.sql
```

## 🚨 Quick Troubleshooting

### PostgreSQL Issues

```bash
# Check if running
sudo systemctl status postgresql

# Restart service
sudo systemctl restart postgresql

# Check connections
sudo -u postgres psql -c "SELECT * FROM pg_stat_activity;"
```

### Application Issues

```bash
# Restart app
pm2 restart afct-dashboard

# Check logs
pm2 logs afct-dashboard --lines 20

# Check disk space
df -h
```

### Permission Issues

```bash
# Fix app permissions
sudo chown -R $USER:$USER /var/www/afct

# Fix upload directory
chmod 755 /var/www/afct/public/uploads
```

## 📋 Production Checklist

- [ ] PostgreSQL installed and running
- [ ] Database and user created
- [ ] Application code deployed
- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] Application built and started with PM2
- [ ] Firewall configured
- [ ] Nginx configured (if using)
- [ ] SSL certificate installed (if using HTTPS)
- [ ] Backup script configured
- [ ] Monitoring set up

## 🆘 Emergency Commands

```bash
# Stop everything
pm2 stop all
sudo systemctl stop nginx
sudo systemctl stop postgresql

# Start everything
sudo systemctl start postgresql
sudo systemctl start nginx
pm2 start all

# Full restart
sudo reboot
```

---

_Keep this reference handy during deployment and maintenance tasks._
