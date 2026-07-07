import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { isAdmin } from '@/lib/permissions';
import type { Prisma } from '@prisma/client';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const clampInt = (value: number, min: number, max: number, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
};

// Build a display name from the parts we have, falling back to email, then id.
function displayName(u: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email || u.id;
}

/**
 * A single page of activity (audit) logs, newest first, with `userId` resolved to
 * the author's display name. Search, severity filter, and sort all run server-side.
 * @openapi
 * summary: List activity (audit) logs
 * parameters:
 *   - { name: page, in: query, schema: { type: integer, minimum: 1, default: 1 } }
 *   - { name: pageSize, in: query, schema: { type: integer, minimum: 1, maximum: 200, default: 50 } }
 *   - { name: q, in: query, description: "Match on action, category, or author name/email", schema: { type: string } }
 *   - { name: severity, in: query, schema: { type: string, enum: [INFO, WARNING, ERROR, SECURITY] } }
 *   - { name: sortBy, in: query, schema: { type: string, enum: [timestamp, severity, category, action, ipAddress, userLastName, userFirstName] } }
 *   - { name: sortDir, in: query, schema: { type: string, enum: [asc, desc], default: desc } }
 * responses:
 *   200:
 *     description: One page of logs.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             rows: { type: array, items: { type: object }, description: ActivityLog rows; userId is the resolved author name }
 *             total: { type: integer }
 *             page: { type: integer }
 *             pageSize: { type: integer }
 *             totalPages: { type: integer }
 *   403: { description: Caller is not a system administrator. }
 *   500: { description: Query failed. }
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!isAdmin(session?.user)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const url = new URL(req.url);
    // A missing param must fall back to the default — Number(null) is 0, which
    // would otherwise clamp up to the minimum, so guard on the raw value first.
    const pageRaw = url.searchParams.get('page');
    const pageSizeRaw = url.searchParams.get('pageSize');
    const page = pageRaw ? clampInt(Number(pageRaw), 1, Number.MAX_SAFE_INTEGER, 1) : 1;
    const pageSize = pageSizeRaw
      ? clampInt(Number(pageSizeRaw), 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
    const q = (url.searchParams.get('q') ?? '').trim();
    const severityRaw = (url.searchParams.get('severity') ?? '').trim().toUpperCase();
    const severity = (['INFO', 'WARNING', 'ERROR', 'SECURITY'] as const).find(
      (s) => s === severityRaw,
    );

    // Combine the (optional) text search and the (optional) severity filter.
    const conditions: Prisma.ActivityLogWhereInput[] = [];
    if (q) {
      // Search matches the action or category directly, or logs authored by a
      // user whose name/email matches (userId is an id, so resolve matches first).
      const matchingUsers = await prisma.user.findMany({
        where: {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      const matchedUserIds = matchingUsers.map((u) => u.id);
      conditions.push({
        OR: [
          { action: { contains: q, mode: 'insensitive' } },
          { category: { contains: q, mode: 'insensitive' } },
          ...(matchedUserIds.length ? [{ userId: { in: matchedUserIds } }] : []),
        ],
      });
    }
    if (severity) conditions.push({ severity });
    const where: Prisma.ActivityLogWhereInput = conditions.length ? { AND: conditions } : {};

    // Sorting: only known columns are allowed. `userId` sorts by the author's
    // name (the column shows the resolved name, not the id). Default: newest first.
    const sortDir: 'asc' | 'desc' =
      url.searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
    const sortBy = url.searchParams.get('sortBy') ?? '';
    const ORDER_BY: Record<string, Prisma.ActivityLogOrderByWithRelationInput> = {
      timestamp: { timestamp: sortDir },
      severity: { severity: sortDir },
      category: { category: sortDir },
      action: { action: sortDir },
      ipAddress: { ipAddress: sortDir },
      userId: { user: { lastName: sortDir } },
      userLastName: { user: { lastName: sortDir } },
      userFirstName: { user: { firstName: sortDir } },
    };
    const orderBy = ORDER_BY[sortBy] ?? { timestamp: 'desc' };

    const [total, logs] = await Promise.all([
      prisma.activityLog.count({ where }),
      prisma.activityLog.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // Resolve author names for just the users referenced on this page.
    const userIds = [...new Set(logs.map((l) => l.userId).filter((id): id is string => !!id))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const lookup = Object.fromEntries(users.map((u) => [u.id, u]));

    const rows = logs.map((log) => {
      const u = log.userId ? lookup[log.userId] : null;
      return {
        ...log,
        // Combined display name kept for the Full Log viewer / back-compat.
        userId: u ? displayName(u) : log.userId,
        userFirstName: u?.firstName ?? null,
        userLastName: u?.lastName ?? null,
      };
    });

    return NextResponse.json({
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (error) {
    console.error('[LOGS_LIST_GET_ERROR]', error);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}
