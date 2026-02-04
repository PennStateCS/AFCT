# AFCT Production Setup Guide

## Quick Start

With named Docker volumes, deployment is straightforward:

1. Clone repository to production server
2. Create `.env.production` with your configuration
3. Run `docker compose up -d`

## Docker Volumes (Auto-Managed)

All data persists in named volumes - no host directory setup needed:

- **postgres_data**: PostgreSQL database
- **uploads_data**: Public uploads served by nginx
- **private_uploads**: Private uploads (submissions, etc.)
- **nginx_certs**: SSL certificates

## Environment Variables

Create `.env.production` file:

```env
# Database
POSTGRES_PASSWORD=your_secure_password
DATABASE_URL=postgresql://afct_user:your_secure_password@postgres:5432/afct

# Authentication
NEXTAUTH_SECRET=your_secure_secret
NEXTAUTH_URL=https://your-domain.com
AUTH_TRUST_HOST=true

# Application
NODE_ENV=production
```

## Running Containers

```bash
cd /path/to/afct
docker compose -f docker-compose.yml up -d
```

## Verification

```bash
# Check container status
docker compose ps

# View logs
docker compose logs -f app

# List volumes
docker volume ls | grep afct
```

## Backing Up

```bash
# Database backup
docker exec afct-postgres pg_dump -U afct_user afct > backup.sql

# Restore
docker exec -i afct-postgres psql -U afct_user afct < backup.sql
```

## Troubleshooting

**Permission Denied errors**:

```bash
# Fix permissions (from production server)
sudo chmod -R 775 /opt/afct/uploads
sudo chown -R 1000:1000 /opt/afct/uploads  # if needed
```

**Uploads directory doesn't exist**:

```bash
# Create it
mkdir -p /opt/afct/uploads
chmod 775 /opt/afct/uploads
```

**Postgres won't start**:

```bash
# Verify postgres directory permissions
ls -la /opt/afct/postgres
sudo chmod 700 /opt/afct/postgres
```
