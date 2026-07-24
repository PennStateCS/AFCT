import { statusGet } from '@/lib/api/status-route';
import { collectSessions } from '@/lib/status/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Session tab: recent active sessions (last 24h, deduped) and rolling 5/15/60m
 * counts, from the audit log. Includes other users' session PII (emails, IPs), so
 * system administrators only.
 * @openapi
 * summary: Active session status
 * responses:
 *   200: { description: Active sessions and rolling counts. }
 *   401: { description: Not signed in. }
 *   403: { description: Not a system administrator. }
 */
export const GET = statusGet(collectSessions);
