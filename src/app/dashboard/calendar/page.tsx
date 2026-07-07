import type { Metadata } from 'next';
import CalendarClient from './CalendarClient';
import { auth } from '@/lib/auth';
import {
  getAssignmentsForUserRange,
  getMonthRangeIso,
  resolveUserTimezone,
} from '@/lib/calendar-assignments';

export const metadata: Metadata = {
  title: 'Calendar',
};

export default async function CalendarPage() {
  const session = await auth();

  if (!session?.user?.id) {
    return <CalendarClient initialAssignments={[]} initialMonth={new Date().toISOString()} />;
  }

  const now = new Date();
  const timezone = await resolveUserTimezone(session.user.id);
  const { startIso, endIso } = getMonthRangeIso(now, timezone);

  const initialAssignments = await getAssignmentsForUserRange({
    userId: session.user.id,
    startDate: new Date(startIso),
    endDate: new Date(endIso),
  });

  return <CalendarClient initialAssignments={initialAssignments} initialMonth={now.toISOString()} />;
}
