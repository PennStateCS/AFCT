import { statusGet } from '@/lib/api/status-route';
import { collectRateLimits } from '@/lib/status/rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Rate Limits tab: every client IP currently blocked or under a captcha-challenge
 * cooldown, with why it was restricted, since when, how hard it is still knocking,
 * when the restriction lifts on its own, and what is known about the address itself
 * (where it sits in the address space, its reverse-DNS name, and whether AFCT's own
 * activity log has seen it before).
 *
 * The rate limiter keeps its buckets in process memory, so this reports the state of
 * the instance that serves the request and resets when the app restarts. It exposes
 * visitors' IP addresses, so system administrators only.
 * @openapi
 * summary: Currently rate-limited IP addresses
 * responses:
 *   200: { description: The IP addresses currently restricted on this instance. }
 *   401: { description: Not signed in. }
 *   403: { description: Not a system administrator. }
 */
export const GET = statusGet(collectRateLimits);
