import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { toEndOfDayInTimezone } from '@/lib/date-utils';
import { getAssignmentsForUserRange, resolveUserTimezone } from '@/lib/calendar-assignments';
import { logError } from '@/lib/api/activity';
import { readJson } from '@/lib/api/request';

const RangeBody = z.object({ start: z.string().min(1), end: z.string().min(1) });

/**
 * Returns the assignments visible to the signed-in user whose due dates fall in a
 * date range — the data behind the calendar view. Role-based visibility is applied
 * inside getAssignmentsForUserRange. Bare dates are widened to cover the whole day
 * in the user's timezone.
 * @openapi
 * summary: List my assignments in a date range
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [start, end]
 *         properties:
 *           start: { type: string, description: Date or datetime; bare dates start at 00:00 }
 *           end: { type: string, description: Date or datetime; bare dates end at 23:59 }
 * responses:
 *   200:
 *     description: Assignments due within the range.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   400: { description: Missing start or end. }
 *   401: { description: Not signed in. }
 *   500: { description: Server error. }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.inactive)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = await readJson(req, RangeBody);
    if (!parsed.ok) return parsed.response;
    const { start, end } = parsed.data;

    const userTimezone = await resolveUserTimezone(session.user.id);
    const startInput = start.includes('T') ? start : `${start}T00:00`;
    const endInput = end.includes('T') ? end : `${end}T23:59`;
    const startDate = toEndOfDayInTimezone(startInput, userTimezone);
    const endDate = toEndOfDayInTimezone(endInput, userTimezone);

    const assignments = await getAssignmentsForUserRange({
      userId: session.user.id,
      startDate,
      endDate,
    });

    return NextResponse.json(assignments, { status: 200 });
  } catch (error) {
    console.error('Error fetching assignment range:', error);
    await logError(req, {
      userId: null,
      action: 'ASSIGNMENT_RANGE_ERROR',
      error,
    });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
