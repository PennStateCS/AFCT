// lib/prisma-config.ts
// This file helps determine which Prisma schema to use based on environment

export const getPrismaSchemaPath = () => {
  if (process.env.NODE_ENV === 'production') {
    return 'prisma/schema.production.prisma';
  }
  return 'prisma/schema.prisma'; // Default to SQLite for development
};

export const getDatabaseProvider = () => {
  if (process.env.NODE_ENV === 'production') {
    return 'postgresql';
  }
  return 'sqlite';
};
