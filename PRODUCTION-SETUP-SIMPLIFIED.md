# AFCT Dashboard Production Setup Guide

This guide provides simplified steps for setting up AFCT Dashboard in production with PostgreSQL.

## Quick Production Setup

### Option 1: Using the Setup Wizard (Recommended)

1. **Run the setup wizard:**
   ```bash
   ./scripts/setup-wizard.sh
   ```

2. **Choose option 7: Setup Production Database (PostgreSQL)**
   - The wizard will automatically handle database creation, schema synchronization, and seeding
   - Uses `db push` instead of migrations to avoid SQLite/PostgreSQL compatibility issues

3. **Start the application:**
   ```bash
   npm run start:prod
   ```

### Option 2: Manual Setup

1. **Install PostgreSQL** (if not already installed):
   ```bash
   sudo apt update
   sudo apt install postgresql postgresql-contrib
   ```

2. **Create database and user:**
   ```bash
   sudo -u postgres psql
   CREATE USER afct_user WITH PASSWORD 'your_password';
   CREATE DATABASE afct_production OWNER afct_user;
   GRANT ALL PRIVILEGES ON DATABASE afct_production TO afct_user;
   \q
   ```

3. **Create production environment file:**
   ```bash
   cp .env.example .env.production
   ```
   
   Edit `.env.production`:
   ```env
   DATABASE_URL="postgresql://afct_user:your_password@localhost:5432/afct_production"
   NODE_ENV="production"
   NEXTAUTH_SECRET="your_secret_key"
   NEXTAUTH_URL="http://your-domain.com"
   ```

4. **Synchronize database schema:**
   ```bash
   npm run db:generate:prod
   npx prisma db push --schema=prisma/schema.production.prisma
   ```

5. **Seed the database:**
   ```bash
   npm run seed:simple
   ```

6. **Start the application:**
   ```bash
   npm run start:prod
   ```

## Troubleshooting Migration Issues

### Common Issues and Solutions

1. **SQLite/PostgreSQL Migration Mismatch:**
   - **Problem:** Migrations created for SQLite don't work with PostgreSQL
   - **Solution:** Use `npx prisma db push` instead of migrations for production
   - **Why:** `db push` synchronizes schema directly without migration files

2. **Invalid Database URL:**
   - **Problem:** Special characters in password cause connection issues
   - **Solution:** URL-encode special characters or use simpler passwords

3. **Missing aboutStudentId Column:**
   - **Problem:** Schema mismatch between development and production
   - **Solution:** Run the setup wizard option 14 to check migration issues

### Setup Wizard Troubleshooting Options

Run `./scripts/setup-wizard.sh` and use these options:

- **Option 14:** Check Migration Issues
- **Option 15:** Validate Production Environment  
- **Option 16:** Database Troubleshooting

## Default Users (After Seeding)

- **Admin:** admin@afct.edu / password123
- **Faculty:** faculty@afct.edu / password123
- **Student:** student@afct.edu / password123

⚠️ **Change these passwords after first login!**

## Production Considerations

1. **Security:**
   - Change default passwords immediately
   - Use strong, unique secrets in `.env.production`
   - Configure proper firewall rules

2. **Performance:**
   - Set up connection pooling for PostgreSQL
   - Configure proper PostgreSQL settings for your server

3. **Monitoring:**
   - Set up log monitoring
   - Monitor database performance
   - Set up health checks

## Architecture Notes

### Why db push instead of migrations?

The setup wizard uses `npx prisma db push` for production setup because:

1. **Compatibility:** Avoids SQLite/PostgreSQL migration compatibility issues
2. **Simplicity:** Directly synchronizes schema without migration history
3. **Reliability:** Less prone to migration conflicts and provider mismatches

### Schema Files

- `prisma/schema.prisma` - Development schema (SQLite)
- `prisma/schema.production.prisma` - Production schema (PostgreSQL)
- `prisma/schema.development.prisma` - Copy of development schema

## Getting Help

If you encounter issues:

1. Run the setup wizard's diagnostic options (14-16)
2. Check the troubleshooting documentation in `docs/`
3. Verify PostgreSQL service is running: `sudo systemctl status postgresql`
4. Test database connection: `npm run db:test:prod`

## Updates and Maintenance

To update the production database schema:

1. Update `prisma/schema.production.prisma`
2. Run: `npx prisma db push --schema=prisma/schema.production.prisma`
3. Restart the application: `npm run start:prod`
