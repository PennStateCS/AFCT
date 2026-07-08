import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isAdmin } from '@/lib/permissions';
import { EXPORTABLE_LOG_FIELDS } from '@/lib/log-fields';

/**
 * Lists the activity-log columns that may be included in a CSV export; drives the
 * Download dialog's field picker. Nested under `export` because it describes what
 * the sibling `POST /admin/logs/export` accepts. System administrators only.
 * @openapi
 * summary: List exportable log fields
 * responses:
 *   200:
 *     description: The exportable field names.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: string } }
 *   403: { description: Caller is not a system administrator. }
 */
export async function GET() {
  const session = await auth();
  if (!isAdmin(session?.user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  return NextResponse.json([...EXPORTABLE_LOG_FIELDS]);
}
