import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { toEndOfDayInTimezone } from '@/lib/date-utils';
import { getAssignmentsForUserRange, resolveUserTimezone } from '@/lib/calendar-assignments';
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json()) as { start: string; end: string };
    const { start, end } = body;
    if (!start || !end) {
      return NextResponse.json({ error: 'Missing start or end' }, { status: 400 });
    }

    const userTimezone = await resolveUserTimezone(session.user.id);
    const startInput = start.includes('T') ? start : `${start}T00:00`;
    const endInput = end.includes('T') ? end : `${end}T23:59`;
    const startDate = toEndOfDayInTimezone(startInput, userTimezone);
    const endDate = toEndOfDayInTimezone(endInput, userTimezone);

    const assignments = await getAssignmentsForUserRange({
      userId: session.user.id,
      role: session.user.role,
      startDate,
      endDate,
    });

    return NextResponse.json(assignments, { status: 200 });
  } catch (error) {
    console.error('Error fetching assignment range:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
