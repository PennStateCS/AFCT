import { statusGet } from '@/lib/api/status-route';
import { collectNetwork } from '@/lib/status/network';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Network tab: DNS resolution for the DB and auth hosts, auth-endpoint latency +
 * TLS certificate expiry, DB round-trip latency and connection count, and recent
 * error-rate ratios. DNS/TLS are TTL-cached. System administrators only.
 * @openapi
 * summary: Network status (DNS/TLS/latency/error-rate)
 * responses:
 *   200: { description: Upstream connectivity probes and error-rate summaries. }
 *   401: { description: Not signed in. }
 *   403: { description: Not a system administrator. }
 */
export const GET = statusGet((req) => collectNetwork(new URL(req.url).origin));
