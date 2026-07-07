import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { EXPORTABLE_LOG_FIELDS } from '@/lib/log-fields';

/**
 * Lists the activity-log columns that may be included in a CSV export; drives the
 * Download dialog's field picker. Admin/Faculty only.
 * @openapi
 * summary: List exportable log fields
 * responses:
 *   200:
 *     description: The exportable field names.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: string } }
 *   403: { description: Caller is not an admin or faculty user. }
 */
export async function GET() {
  const session = await auth();
  if (!session || !['ADMIN', 'FACULTY'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  return NextResponse.json([...EXPORTABLE_LOG_FIELDS]);
}
