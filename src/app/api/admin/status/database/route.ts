import { statusGet } from '@/lib/api/status-route';
import { collectDatabase } from '@/lib/status/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Database tab: reachability, engine details, per-engine stats (Postgres or
 * SQLite), and the last migration. System administrators only.
 * @openapi
 * summary: Database status
 * responses:
 *   200: { description: "DB health, details, and engine stats." }
 *   401: { description: Not signed in. }
 *   403: { description: Not a system administrator. }
 */
export const GET = statusGet(collectDatabase);
