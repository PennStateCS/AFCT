/**
 * Builds the Rate Limits tab payload: the live restrictions from the rate limiter, each
 * enriched with whatever can be worked out about the address.
 *
 * Three sources, deliberately all local:
 *   1. address classification, pure and offline (`ip-classify`);
 *   2. a reverse-DNS name from the resolver the server already uses;
 *   3. what AFCT's own activity log says about the address.
 *
 * No third-party geolocation or WHOIS service is called. Doing so would send visitors'
 * addresses to an outside company, need egress and an API key, and break on an install
 * that has neither, in exchange for a city name that does not answer the question an
 * administrator actually has ("is this our lab?"). The activity log answers that better.
 */

import { promises as dns } from 'dns';
import { prisma } from '@/lib/prisma';
import { listRestrictedIps } from '@/lib/security/rate-limiter';
import { classifyIp, ipKindLabel } from '@/lib/status/ip-classify';
import type {
  HostnameLookup,
  IpDetails,
  IpKnownActivity,
  RateLimitedAddress,
  RateLimitsStatusResponse,
} from '@/lib/status/types';

/** How far back the activity log is searched for an address. */
const ACTIVITY_WINDOW_DAYS = 30;
/** Rows scanned per refresh across all restricted addresses; keeps a poll bounded. */
const ACTIVITY_SCAN_LIMIT = 2_000;
/** Accounts named per address; the full count is reported separately. */
const ACCOUNT_SAMPLE = 5;
/** Enriched addresses per refresh. Beyond this the restriction still lists, plainly. */
const ENRICH_LIMIT = 25;
/** A reverse lookup is a network round trip, so it never holds the page for long. */
const PTR_TIMEOUT_MS = 800;
const PTR_TTL_MS = 10 * 60_000;
/** Bounded so a flood of unique addresses cannot grow the cache without limit. */
const PTR_CACHE_MAX = 500;

type PtrEntry = { hostname: string | null; lookup: HostnameLookup; expires: number };
const ptrCache = new Map<string, PtrEntry>();

const rememberPtr = (ip: string, entry: PtrEntry) => {
  // Map preserves insertion order, so the first key is the oldest.
  while (ptrCache.size >= PTR_CACHE_MAX) {
    const oldest = ptrCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    ptrCache.delete(oldest);
  }
  ptrCache.set(ip, entry);
};

/**
 * Reverse-DNS name for an address, or null. Never throws and never blocks for long: an
 * address with no PTR record is the normal case, not an error, and a slow or missing
 * resolver must not stall the whole tab.
 */
const lookupHostname = async (ip: string): Promise<Pick<PtrEntry, 'hostname' | 'lookup'>> => {
  const now = Date.now();
  const hit = ptrCache.get(ip);
  if (hit && hit.expires > now) return { hostname: hit.hostname, lookup: hit.lookup };

  let result: Pick<PtrEntry, 'hostname' | 'lookup'>;
  try {
    const names = await Promise.race([
      dns.reverse(ip),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('reverse DNS timed out')), PTR_TIMEOUT_MS),
      ),
    ]);
    const hostname = names.find((name) => name.length > 0) ?? null;
    result = { hostname, lookup: hostname ? 'ok' : 'none' };
  } catch {
    // NXDOMAIN (no PTR) and a dead resolver are indistinguishable here, and neither is
    // worth surfacing as a failure the administrator has to act on.
    result = { hostname: null, lookup: 'failed' };
  }

  rememberPtr(ip, { ...result, expires: now + PTR_TTL_MS });
  return result;
};

type ActivityRow = { ipAddress: string | null; userId: string | null; timestamp: Date };

/**
 * One pass over the recent activity log for every restricted address at once, so the
 * number of queries does not grow with the number of restrictions. Returns null for
 * every address if the log cannot be read: a database hiccup should degrade this panel,
 * not empty it.
 */
const loadKnownActivity = async (
  ips: string[],
): Promise<Map<string, IpKnownActivity> | null> => {
  if (ips.length === 0) return new Map();
  const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  let rows: ActivityRow[];
  try {
    rows = (await prisma.activityLog.findMany({
      where: { ipAddress: { in: ips }, timestamp: { gte: since } },
      select: { ipAddress: true, userId: true, timestamp: true },
      orderBy: { timestamp: 'desc' },
      take: ACTIVITY_SCAN_LIMIT,
    })) as ActivityRow[];
  } catch (error) {
    console.error('Rate-limit activity lookup failed:', error);
    return null;
  }

  const truncated = rows.length >= ACTIVITY_SCAN_LIMIT;
  const byIp = new Map<string, { events: number; users: Set<string>; first: number; last: number }>();
  for (const row of rows) {
    if (!row.ipAddress) continue;
    const ts = row.timestamp.getTime();
    const bucket = byIp.get(row.ipAddress) ?? {
      events: 0,
      users: new Set<string>(),
      first: ts,
      last: ts,
    };
    bucket.events += 1;
    if (row.userId) bucket.users.add(row.userId);
    bucket.first = Math.min(bucket.first, ts);
    bucket.last = Math.max(bucket.last, ts);
    byIp.set(row.ipAddress, bucket);
  }

  // Resolve the sampled user ids to something an administrator recognises.
  const sampledIds = [...byIp.values()].flatMap((b) => [...b.users].slice(0, ACCOUNT_SAMPLE));
  const users = sampledIds.length
    ? await prisma.user.findMany({
        where: { id: { in: [...new Set(sampledIds)] } },
        select: { id: true, email: true },
      })
    : [];
  const labelFor = new Map(users.map((u) => [u.id, u.email]));

  const result = new Map<string, IpKnownActivity>();
  for (const ip of ips) {
    const bucket = byIp.get(ip);
    result.set(ip, {
      windowDays: ACTIVITY_WINDOW_DAYS,
      eventCount: bucket?.events ?? 0,
      accountCount: bucket?.users.size ?? 0,
      accounts: bucket
        ? [...bucket.users].slice(0, ACCOUNT_SAMPLE).map((id) => labelFor.get(id) ?? id)
        : [],
      firstSeen: bucket?.first ?? null,
      lastSeen: bucket?.last ?? null,
      truncated,
    });
  }
  return result;
};

/** The restrictions in force on this instance, each with what is known about the address. */
export async function collectRateLimits(): Promise<RateLimitsStatusResponse> {
  const entries = listRestrictedIps();
  const enriched = entries.slice(0, ENRICH_LIMIT);
  const classified = enriched.map((entry) => ({ entry, ...classifyIp(entry.ip) }));

  // A private, loopback or unreadable address is not worth a resolver round trip.
  const [activity, hostnames] = await Promise.all([
    loadKnownActivity(enriched.map((e) => e.ip)),
    Promise.all(
      classified.map(async ({ entry, kind }) =>
        kind === 'public' || kind === 'shared'
          ? { ip: entry.ip, ...(await lookupHostname(entry.ip)) }
          : { ip: entry.ip, hostname: null, lookup: 'skipped' as HostnameLookup },
      ),
    ),
  ]);
  const hostnameFor = new Map(hostnames.map((h) => [h.ip, h]));

  const withDetails: RateLimitedAddress[] = entries.map((entry, index) => {
    const classification = classified[index];
    const host = hostnameFor.get(entry.ip);
    const details: IpDetails =
      classification && host
        ? {
            version: classification.version,
            kind: classification.kind,
            kindLabel: ipKindLabel(classification.kind),
            hostname: host.hostname,
            hostnameLookup: host.lookup,
            knownActivity: activity?.get(entry.ip) ?? null,
          }
        : // Past the enrichment cap: still classify (it costs nothing) but look nothing up.
          {
            ...classifyIp(entry.ip),
            kindLabel: ipKindLabel(classifyIp(entry.ip).kind),
            hostname: null,
            hostnameLookup: 'skipped',
            knownActivity: null,
          };
    return { ...entry, details };
  });

  return { entries: withDetails, generatedAt: Date.now() };
}

/** Drop cached reverse-DNS results (tests). */
export const __clearPtrCache = () => ptrCache.clear();
