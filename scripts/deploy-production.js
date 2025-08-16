#!/usr/bin/env node

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execSync } = require('child_process');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

console.log('🚀 Starting production deployment...');

try {
  // Set environment to production
  process.env.NODE_ENV = 'production';
  
  // Copy production environment file if it exists
  const prodEnvPath = path.join(__dirname, '..', '.env.production');
  const envPath = path.join(__dirname, '..', '.env');
  
  if (fs.existsSync(prodEnvPath)) {
    console.log('📄 Copying production environment file...');
    fs.copyFileSync(prodEnvPath, envPath);
  }

  // Generate Prisma client for PostgreSQL
  console.log('📦 Generating Prisma client for PostgreSQL...');
  execSync('npm run db:generate:prod', { stdio: 'inherit' });

  // Run database migrations
  console.log('🗄️ Running database migrations...');
  execSync('npm run db:migrate:prod', { stdio: 'inherit' });

  // Build the application
  console.log('🔨 Building application...');
  execSync('npm run build:prod', { stdio: 'inherit' });

  console.log('✅ Production deployment complete!');
  console.log('You can now run \'npm start\' to start the production server');

} catch (error) {
  console.error('❌ Deployment failed:', error.message);
  process.exit(1);
}
