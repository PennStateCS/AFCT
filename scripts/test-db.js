#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Simple database connection test for AFCT Dashboard
 * Tests both SQLite (development) and PostgreSQL (production) connections
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

async function testConnection(envFile = '.env.local') {
  console.log(`\n🔧 Testing database connection using ${envFile}...`);

  try {
    // Load environment variables
    if (fs.existsSync(envFile)) {
      const envContent = fs.readFileSync(envFile, 'utf8');
      const envVars = {};

      envContent.split('\n').forEach((line) => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          const value = match[2].trim().replace(/^["']|["']$/g, '');
          envVars[key] = value;
        }
      });

      // Set environment variables
      Object.assign(process.env, envVars);
      console.log(`✓ Loaded environment from ${envFile}`);
      console.log(`  DATABASE_URL: ${process.env.DATABASE_URL ? 'Set' : 'Not set'}`);
    } else {
      console.log(`⚠ Environment file ${envFile} not found`);
    }

    // Test database connection
    const prisma = new PrismaClient();

    console.log('🔌 Attempting to connect to database...');
    await prisma.$connect();
    console.log('✓ Database connection successful');

    // Test a simple query
    console.log('🔍 Testing database query...');
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('✓ Database query successful:', result);

    await prisma.$disconnect();
    console.log('✓ Database disconnected cleanly');

    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error.message);

    if (error.code === 'P1001') {
      console.log("\n📋 Troubleshooting P1001 (Can't reach database):");
      console.log('  - Check if PostgreSQL service is running: sudo systemctl status postgresql');
      console.log('  - Check if database exists: sudo -u postgres psql -l');
      console.log('  - Verify connection string in environment file');
    } else if (error.code === 'P1010') {
      console.log('\n📋 Troubleshooting P1010 (User access denied):');
      console.log('  - Check PostgreSQL authentication: /etc/postgresql/*/main/pg_hba.conf');
      console.log('  - Verify user exists: sudo -u postgres psql -c "\\du"');
      console.log(
        '  - Test manual connection: PGPASSWORD=yourpass psql -h localhost -U youruser -d yourdb',
      );
    }

    return false;
  }
}

async function main() {
  console.log('🗄️ AFCT Dashboard Database Connection Test\n');

  const args = process.argv.slice(2);
  const envFile = args[0] || '.env.local';

  const success = await testConnection(envFile);

  if (success) {
    console.log('\n🎉 All database tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Database connection test failed');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
