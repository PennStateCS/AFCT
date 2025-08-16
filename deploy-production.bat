@echo off
echo 🚀 Starting production deployment...

REM Set environment to production
set NODE_ENV=production

REM Copy production environment file
copy .env.production .env

REM Generate Prisma client for PostgreSQL
echo 📦 Generating Prisma client for PostgreSQL...
npx prisma generate --schema=prisma/schema.production.prisma

REM Run database migrations
echo 🗄️ Running database migrations...
npx prisma migrate deploy --schema=prisma/schema.production.prisma

REM Build the application
echo 🔨 Building application...
npm run build:prod

echo ✅ Production deployment complete!
echo You can now run 'npm start' to start the production server
