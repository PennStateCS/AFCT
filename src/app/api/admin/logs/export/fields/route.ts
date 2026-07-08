import { NextResponse } from 'next/server';
import { EXPORTABLE_LOG_FIELDS } from '@/lib/log-fields';
import { withAdminAuth } from '@/lib/api/with-auth';

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
export const GET = withAdminAuth(() => NextResponse.json([...EXPORTABLE_LOG_FIELDS]));
