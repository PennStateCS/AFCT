import type { PeerCertificate } from 'tls';
import { prisma } from '@/lib/prisma';
import { cached, STATUS_TTL } from '@/lib/status/cache';
import { detectProvider } from '@/lib/status/database';
import type { NetworkStatusResponse } from '@/lib/status/types';

async function resolveHost(host?: string | null): Promise<string[] | null> {
  if (!host) return null;
  try {
    const dns = await import('dns');
    const results = await dns.promises.lookup(host, { all: true });
    return Array.from(new Set(results.map((r) => r.address)));
  } catch {
    return null;
  }
}

async function measureFetchLatency(url?: string | null, timeoutMs = 3000): Promise<number | null> {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = performance.now();
    await fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal });
    const t1 = performance.now();
    clearTimeout(timer);
    return Math.round(t1 - t0);
  } catch {
    return null;
  }
}

async function getTlsExpiry(host?: string | null, port?: number | null): Promise<string | null> {
  if (!host) return null;
  try {
    const tls = await import('tls');
    const p = port ?? 443;
    const cert = await new Promise<PeerCertificate>((resolve, reject) => {
      const socket = tls.connect(
        { host, port: p, servername: host, rejectUnauthorized: false, timeout: 3000 },
        () => {
          const c = socket.getPeerCertificate();
          socket.end();
          resolve(c);
        },
      );
      socket.on('error', (err) => reject(err));
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('timeout'));
      });
    });
    const validTo = (cert as { valid_to?: string }).valid_to;
    if (!validTo) return null;
    const dt = new Date(validTo);
    return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
  } catch {
    return null;
  }
}

/**
 * Upstream connectivity probes: DNS resolution for the DB and auth hosts, auth
 * endpoint latency + TLS certificate expiry, a DB round-trip latency, and recent
 * error-rate ratios from the audit log. DNS and TLS are TTL-cached (slow-changing
 * infra facts); latency is always measured live.
 */
export async function collectNetwork(origin: string): Promise<NetworkStatusResponse> {
  const dbUrl = process.env.DATABASE_URL ?? '';
  const provider = detectProvider(dbUrl);
  const authBase = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : origin;
  const authProbeUrl = new URL('/api/auth/session', authBase).toString();

  let dbHost: string | null = null;
  let dbPort: number | null = null;
  if (provider === 'postgres' || provider === 'unknown') {
    try {
      const u = new URL(dbUrl);
      dbHost = u.hostname || null;
      dbPort = u.port ? Number(u.port) : 5432;
    } catch {
      dbHost = null;
      dbPort = null;
    }
  }

  let authHost: string | null = null;
  let authPort: number | null = null;
  let authProtocol: string | null = null;
  try {
    const u = new URL(authBase);
    authHost = u.hostname || null;
    authPort = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
    authProtocol = u.protocol || null;
  } catch {
    authHost = null;
    authPort = null;
    authProtocol = null;
  }

  // DB round-trip latency (its own light probe, so the route stays independent).
  let dbLatencyMs: number | null = null;
  let dbConnections: number | null = null;
  try {
    const start = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Math.round(performance.now() - start);
    if (provider === 'postgres' || provider === 'unknown') {
      try {
        const nb = (await prisma.$queryRaw`
          SELECT numbackends::int as num_backends
          FROM pg_stat_database WHERE datname = current_database()
        `) as Array<{ num_backends?: number }>;
        const n = nb?.[0]?.num_backends;
        dbConnections = typeof n === 'number' ? n : null;
      } catch {}
    }
  } catch {}

  const [dbResolved, authResolved, authLatencyMs, authCertExpiry] = await Promise.all([
    cached(`dns:${dbHost}`, STATUS_TTL.network, () => resolveHost(dbHost)),
    cached(`dns:${authHost}`, STATUS_TTL.network, () => resolveHost(authHost)),
    measureFetchLatency(authProbeUrl),
    authProtocol === 'https:'
      ? cached(`tls:${authHost}:${authPort}`, STATUS_TTL.network, () =>
          getTlsExpiry(authHost, authPort),
        )
      : Promise.resolve(null),
  ]);

  const nowMs = Date.now();
  const since5m = new Date(nowMs - 5 * 60 * 1000);
  const since15m = new Date(nowMs - 15 * 60 * 1000);
  const errorWhere = {
    OR: [
      { action: { contains: 'error', mode: 'insensitive' as const } },
      { action: { contains: 'fail', mode: 'insensitive' as const } },
      { action: { contains: 'denied', mode: 'insensitive' as const } },
      { action: { contains: 'forbidden', mode: 'insensitive' as const } },
    ],
  };

  const [total5m, total15m, err5m, err15m] = await Promise.all([
    prisma.activityLog.count({ where: { timestamp: { gte: since5m } } }),
    prisma.activityLog.count({ where: { timestamp: { gte: since15m } } }),
    prisma.activityLog.count({ where: { timestamp: { gte: since5m }, ...errorWhere } }),
    prisma.activityLog.count({ where: { timestamp: { gte: since15m }, ...errorWhere } }),
  ]);

  const rate = (errors: number, total: number) => (total > 0 ? (errors / total) * 100 : 0);

  return {
    db: {
      host: dbHost,
      port: dbPort,
      resolved: dbResolved,
      latencyMs: dbLatencyMs,
      connections: dbConnections,
    },
    auth: {
      url: authProbeUrl,
      host: authHost,
      port: authPort,
      resolved: authResolved,
      latencyMs: authLatencyMs,
      sslExpiry: authCertExpiry,
    },
    errors: {
      last5m: { total: total5m, errors: err5m, ratePct: rate(err5m, total5m) },
      last15m: { total: total15m, errors: err15m, ratePct: rate(err15m, total15m) },
    },
  };
}
