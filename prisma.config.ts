// prisma.config.ts
import path from "node:path";
import "dotenv/config";              // ← Prisma doesn't auto-load .env when using prisma.config.ts
import { defineConfig } from "prisma/config";

export default defineConfig({
  // Where Prisma should find your schema
  schema: path.join("prisma", "schema.prisma"),

  // Migrate/seed settings
  migrations: {
    // (Optional) explicit path; defaults to the folder next to your schema anyway
    path: path.join("prisma", "migrations"),

    // Command Prisma runs for `prisma db seed`
    // Using tsx since your seed is TypeScript
    seed: "tsx prisma/seed.ts",
  },

  // Example: enable any experimental flags you actually need (leave empty if not using)
  // experimental: {
  //   studio: false,
  //   adapter: false,
  //   externalTables: false,
  // },
});
