import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { safeAuditLog } from '@/lib/api/activity';
import { DownloadLogsSchema } from '@/schemas/log';
import { EXPORTABLE_LOG_FIELDS } from '@/lib/log-fields';
import { withAdminAuth } from '@/lib/api/with-auth';
import { parseValidDate } from '@/lib/date-format';
import type { Prisma } from '@prisma/client';

// Upper bound so a single export can't try to page the entire table into memory.
const MAX_EXPORT_ROWS = 100_000;

/**
 * Returns the selected activity-log columns within a time range, for CSV export.
 * System administrators only. Column names are validated against the exportable allow-list
 * before reaching the Prisma select (guards field injection), and the result is
 * capped at MAX_EXPORT_ROWS so one export can't page the whole table into memory.
 * @openapi
 * summary: Export activity logs
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [cols, begTime, endTime]
 *         properties:
 *           cols: { type: array, items: { type: string }, description: Field names from getFields }
 *           begTime: { type: string, description: Start of range (datetime-local; ignored if unparseable) }
 *           endTime: { type: string, description: End of range (datetime-local; ignored if unparseable) }
 * responses:
 *   200:
 *     description: Matching log rows with only the requested columns.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   400: { description: "Invalid JSON, failed validation, or no valid fields selected." }
 *   403: { description: Caller is not a system administrator. }
 *   500: { description: Export failed. }
 */
export const POST = withAdminAuth(
  async (req: Request, _ctx: unknown, { user }) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = DownloadLogsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { cols, begTime, endTime } = parsed.data;

    // Only allow known columns through to the Prisma select (guards field injection).
    const allowed = new Set<string>(EXPORTABLE_LOG_FIELDS);
    const validCols = cols.filter((c) => allowed.has(c));
    if (validCols.length === 0) {
      return NextResponse.json({ error: 'No valid fields selected' }, { status: 400 });
    }
    const select = Object.fromEntries(validCols.map((c) => [c, true])) as Prisma.ActivityLogSelect;

    // begTime/endTime are datetime-local strings; ignore either if unparseable.
    const beg = parseValidDate(begTime);
    const end = parseValidDate(endTime);
    const timestamp: Prisma.DateTimeFilter = {};
    if (beg) timestamp.gte = beg;
    if (end) timestamp.lte = end;
    const where: Prisma.ActivityLogWhereInput = timestamp.gte || timestamp.lte ? { timestamp } : {};

    try {
      const rows = await prisma.activityLog.findMany({
        where,
        select,
        orderBy: { timestamp: 'desc' },
        take: MAX_EXPORT_ROWS,
      });
      /**
       * Never throttled, unlike the view of the same data. An export is a copy of education
       * records leaving AFCT for a spreadsheet on somebody's laptop, which is the shape of
       * thing a disclosure record exists to capture, and every one of them is its own event.
       *
       * What was taken, not what it said: the row count, the window and the columns chosen.
       * Copying the exported rows into the entry would duplicate the exposure it records.
       */
      await safeAuditLog('ADMIN_LOGS_EXPORTED', req, {
        userId: user.id,
        action: 'ADMIN_LOGS_EXPORTED',
        severity: 'INFO',
        category: 'SYSTEM',
        metadata: {
          rows: rows.length,
          truncated: rows.length >= MAX_EXPORT_ROWS,
          fields: validCols,
          ...(beg ? { from: beg.toISOString() } : {}),
          ...(end ? { to: end.toISOString() } : {}),
        },
      });

      return NextResponse.json(rows);
    } catch (error) {
      console.error('[LOGS_EXPORT_POST_ERROR]', error);
      return NextResponse.json({ error: 'Failed to export logs' }, { status: 500 });
    }
  },
  { deniedAction: 'ADMIN_LOGS_EXPORT_DENIED' },
);
