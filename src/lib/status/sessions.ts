import { prisma } from '@/lib/prisma';
import type { SessionItem, SessionsStatusResponse } from '@/lib/status/types';

const metaField = (m: unknown, k: string): string | null => {
  if (!m || typeof m !== 'object') return null;
  const v = (m as Record<string, unknown>)[k];
  return v == null ? null : String(v);
};

/**
 * Recent active-session heuristic from the audit log: the last 24h of login /
 * presence events, deduped per user (or ip|ua), plus rolling 5/15/60-minute
 * counts. Capped at 200 records / 500 rows scanned.
 */
export async function collectSessions(): Promise<SessionsStatusResponse> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = (await prisma.activityLog.findMany({
    where: {
      timestamp: { gte: since },
      action: { in: ['LOGIN_SUCCESS', 'SESSION_EXTENDED', 'LOGIN', 'PRESENCE_BEAT'] },
    },
    orderBy: { timestamp: 'desc' },
    take: 500,
  })) as Array<{
    userId?: string | null;
    metadata?: unknown;
    ipAddress?: string | null;
    userAgent?: string | null;
    timestamp?: Date | string | null;
  }>;

  const seen = new Map<string, SessionItem>();
  const uniqUsers = new Set<string>();
  const now = Date.now();
  let last5m = 0;
  let last15m = 0;
  let last60m = 0;

  for (const r of rows) {
    const meta = r.metadata;
    const uid = typeof r.userId === 'string' ? r.userId : metaField(meta, 'userId');
    const email = metaField(meta, 'email');
    const ip = typeof r.ipAddress === 'string' ? r.ipAddress : metaField(meta, 'ip');
    const ua = typeof r.userAgent === 'string' ? r.userAgent : metaField(meta, 'ua');
    const ts = r.timestamp ? new Date(r.timestamp).getTime() : null;

    if (uid) uniqUsers.add(uid);

    if (ts) {
      const ageMs = now - ts;
      if (ageMs <= 5 * 60 * 1000) last5m++;
      if (ageMs <= 15 * 60 * 1000) last15m++;
      if (ageMs <= 60 * 60 * 1000) last60m++;
    }

    const key = uid ?? (ip || ua ? `${ip ?? ''}|${ua ?? ''}` : JSON.stringify(meta ?? {}));
    if (!seen.has(key)) {
      seen.set(key, {
        userId: uid ?? null,
        email: email ?? null,
        ipAddress: ip ?? null,
        userAgent: ua ?? null,
        lastSeen: ts ? new Date(ts).toISOString() : null,
      });
    }
    if (seen.size >= 200) break;
  }

  return {
    activeSessions: Array.from(seen.values()),
    summary: {
      total24h: rows.length,
      uniqUsers24h: uniqUsers.size,
      last5m,
      last15m,
      last60m,
    },
  };
}
