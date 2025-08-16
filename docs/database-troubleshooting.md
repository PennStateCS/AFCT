# Database Setup Troubleshooting Guide

## Common Issues and Solutions

### 1. ERD Generation Errors

**Problem**: Puppeteer can't find Chrome even when Chrome/Chromium is installed.

```
Error: Could not find Chrome (ver. 131.0.6778.204)
```

**Solutions**:

1. Install Puppeteer's Chrome browser:

   ```bash
   npx puppeteer browsers install chrome
   ```

2. Use the safe fallback generation:

   ```bash
   npm run db:generate:safe
   ```

3. Skip ERD generation entirely (recommended for production):
   ```bash
   npx prisma generate --schema=prisma/schema.production.prisma
   ```

### 2. Production Database Connection Errors (P1010)

**Problem**: User access denied error during production setup.

```
Error: P1010: User was denied access on the database
```

**Solutions**:

1. **Check PostgreSQL service status**:

   ```bash
   sudo systemctl status postgresql
   sudo systemctl restart postgresql
   ```

2. **Verify user and database exist**:

   ```bash
   sudo -u postgres psql -c "\du"  # List users
   sudo -u postgres psql -l        # List databases
   ```

3. **Check authentication configuration**:

   ```bash
   sudo cat /etc/postgresql/*/main/pg_hba.conf | grep afct
   ```

4. **Test manual connection**:

   ```bash
   PGPASSWORD=yourpassword psql -h localhost -U afct_user -d afct_production
   ```

5. **Re-run database setup**:
   ```bash
   ./scripts/setup-wizard.sh
   # Choose option 7: Setup Production Database
   ```

### 3. Prisma Generation Issues

**Problem**: Invalid Prisma flags or generation failures.

**Solutions**:

1. **Use correct schema file**:

   ```bash
   # For development
   npx prisma generate --schema=prisma/schema.development.prisma

   # For production
   npx prisma generate --schema=prisma/schema.production.prisma
   ```

2. **Use npm scripts**:
   ```bash
   npm run db:generate:safe       # Safe generation without ERD
   npm run db:generate:with-erd   # Generation with ERD (requires Chrome)
   ```

### 4. Database Connection Testing

**Use the built-in test tools**:

1. **Test development database (SQLite)**:

   ```bash
   npm run db:test
   ```

2. **Test production database (PostgreSQL)**:

   ```bash
   npm run db:test:prod
   ```

3. **Use the setup wizard troubleshooting**:
   ```bash
   ./scripts/setup-wizard.sh
   # Choose option 14: Database Troubleshooting
   ```

### 5. Migration Issues

**Problem**: Migration failures in production.

**Solutions**:

1. **Use correct schema for migrations**:

   ```bash
   npx prisma migrate deploy --schema=prisma/schema.production.prisma
   ```

2. **Reset development database if corrupted**:

   ```bash
   ./scripts/setup-wizard.sh
   # Choose option 10: Reset Database (Development)
   ```

3. **Reset production database (DANGER - data loss!)**:
   ```bash
   ./scripts/setup-wizard.sh
   # Choose option 11: Reset Database (Production)
   ```

## Setup Wizard Improvements

The setup wizard has been enhanced with:

1. **Better ERD detection**: Tests Puppeteer compatibility before enabling ERD generation
2. **Robust database creation**: Improved error handling for existing databases/users
3. **Schema-specific operations**: Uses explicit schema files instead of copying
4. **Comprehensive testing**: Built-in database connection tests
5. **Troubleshooting tools**: Dedicated troubleshooting menu option
6. **Fallback mechanisms**: Safe fallbacks when ERD generation fails

## Best Practices

### Development Setup

- Use SQLite for development (faster, simpler)
- ERD generation is optional and doesn't affect functionality
- Use `npm run db:generate:safe` for reliable Prisma generation

### Production Setup

- Always use PostgreSQL for production
- Never enable ERD generation in production (performance issues)
- Use schema-specific commands: `--schema=prisma/schema.production.prisma`
- Test connections before deploying

### Troubleshooting Steps

1. Run system health check (option 12)
2. View system status (option 13)
3. Use database troubleshooting (option 14)
4. Check logs and error messages carefully
5. Use manual testing commands when automated tests fail

## Updated Scripts

### Package.json Scripts

- `db:generate:safe` - Safe Prisma generation without ERD
- `db:generate:with-erd` - Generation with ERD (development only)
- `db:generate:fallback` - Fixed fallback without invalid flags
- `db:test` - Test development database connection
- `db:test:prod` - Test production database connection

### Setup Wizard Features

- Option 14: Database Troubleshooting
- Improved error handling and user messaging
- Better Chrome/Chromium detection
- Safer database creation with existing resource handling
- Schema-specific operations to prevent conflicts
