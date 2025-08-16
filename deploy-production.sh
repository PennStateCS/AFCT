#!/bin/bash

# Production deployment script

echo "🚀 Starting production deployment..."

# Set environment to production
export NODE_ENV=production

# Copy production environment file
cp .env.production .env

# Generate Prisma client for PostgreSQL
echo "📦 Generating Prisma client for PostgreSQL..."
npx prisma generate --schema=prisma/schema.production.prisma

# Run database migrations
echo "🗄️ Running database migrations..."
npx prisma migrate deploy --schema=prisma/schema.production.prisma

# Build the application
echo "🔨 Building application..."
npm run build:prod

echo "✅ Production deployment complete!"
echo "You can now run 'npm start' to start the production server"
