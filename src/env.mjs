// src/env.mjs
import { z } from 'zod';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment file based on NODE_ENV
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.local';
const envPath = resolve(process.cwd(), envFile);

// Load environment variables from the appropriate file
config({ path: envPath });

const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // JWT signing secret. Enforced at runtime by requireAuthSecret()
  // (src/lib/auth-secret.ts); kept here so the declared env contract matches.
  NEXTAUTH_SECRET: z.string().min(32),
});

const clientSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().default('AFCT Dashboard'),
});

const merged = {
  ...process.env,
};

// Validate at module load (fail fast)
const _server = serverSchema.safeParse(merged);
if (!_server.success) {
  // surface useful diagnostics during boot
  console.error('❌ Invalid server environment variables:', _server.error.format());
  throw new Error('Invalid server environment variables');
}

const _client = clientSchema.safeParse(merged);
if (!_client.success) {
  console.error('❌ Invalid client environment variables:', _client.error.format());
  throw new Error('Invalid client environment variables');
}

export const env = { ..._server.data, ..._client.data };
