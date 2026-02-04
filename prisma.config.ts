// prisma.config.ts
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
const envPath = path.join(process.cwd(), envFile);
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

export default defineConfig({
  // Where Prisma should find your schema
  schema: path.join('prisma', 'schema.prisma'),

  // Migrate/seed settings
  migrations: {
    // (Optional) explicit path; defaults to the folder next to your schema anyway
    path: path.join('prisma', 'migrations'),

    // Command Prisma runs for `prisma db seed`
    // Using tsx since your seed is TypeScript
    seed: 'tsx prisma/seed.ts',
  },

  // Example: enable any experimental flags you actually need (leave empty if not using)
  // experimental: {
  //   studio: false,
  //   adapter: false,
  //   externalTables: false,
  // },
});
