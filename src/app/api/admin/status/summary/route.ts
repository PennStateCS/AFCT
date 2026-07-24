import { statusGet } from '@/lib/api/status-route';
import { collectSummary } from '@/lib/status/summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Summary cards at the top of the status dashboard: DB reachability/provider,
 * uptime, process CPU/memory, DB table count + size, 24h session counts, and this
 * probe's own latency. Fast by design so it renders immediately while the per-tab
 * detail loads lazily. System administrators only.
 * @openapi
 * summary: Status summary (top cards)
 * responses:
 *   200: { description: Cross-cutting summary numbers for the status cards. }
 *   401: { description: Not signed in. }
 *   403: { description: Not a system administrator. }
 */
export const GET = statusGet(async () => {
  // The reported latency is this probe's own round trip, so it is measured here rather
  // than inside the collector.
  const t0 = performance.now();
  const data = await collectSummary();
  data.latencyMs = Math.round(performance.now() - t0);
  return data;
});
