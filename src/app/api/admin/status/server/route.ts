import { statusGet } from '@/lib/api/status-route';
import { collectServer } from '@/lib/status/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Server tab: host + process metrics (uptime, CPU/memory/disk-IO sample, OS, IP
 * addresses) and software versions (Node/Next/Java/evaluator + build metadata).
 * System administrators only. Tool versions are TTL-cached server-side.
 * @openapi
 * summary: Server status (host + process + software)
 * responses:
 *   200: { description: Server metrics and software versions. }
 *   401: { description: Not signed in. }
 *   403: { description: Not a system administrator. }
 */
export const GET = statusGet(collectServer);
