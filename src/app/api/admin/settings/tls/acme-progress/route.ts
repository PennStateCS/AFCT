import { NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/api/with-auth';
import { readAcmeStatus } from '@/lib/acme';

/**
 * Live progress of an in-flight Let's Encrypt issuance. The admin UI polls this while
 * the (blocking) request runs so it can show step-by-step status instead of a spinner.
 * Admin only. Returns `{ phase: 'idle' }` when nothing has been recorded.
 * @openapi
 * summary: Get Let's Encrypt issuance progress
 * responses:
 *   200:
 *     description: The current issuance phase.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             phase: { type: string }
 *             message: { type: string, nullable: true }
 *             updatedAt: { type: string, nullable: true }
 *   403: { description: Caller is not an admin. }
 */
export const GET = withAdminAuth(() => NextResponse.json(readAcmeStatus() ?? { phase: 'idle' }), {
  deniedAction: 'TLS_STATUS_VIEW_DENIED',
});
