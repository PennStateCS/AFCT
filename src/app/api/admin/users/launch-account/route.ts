import { NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/api/with-auth';
import { findOrphanedLaunchAccount } from '@/lib/lti/jit-duplicates';

/**
 * Whether an LMS has already made an account for the person about to be created.
 *
 * Read-only and deliberately quiet: a miss answers `null` rather than an error, because most
 * names will not match and the dialog asking is not doing anything wrong. Administrators only,
 * like everything else that reads across accounts.
 *
 * @openapi
 * summary: Find an unused account an LMS launch created for this name
 * parameters:
 *   - { name: firstName, in: query, required: true, schema: { type: string } }
 *   - { name: lastName, in: query, required: true, schema: { type: string } }
 * responses:
 *   200: { description: "The account, or null when there is no single safe match." }
 *   400: { description: A name is missing. }
 *   403: { description: System administrators only. }
 */
export const GET = withAdminAuth(
  async (req) => {
    const params = new URL(req.url).searchParams;
    const firstName = params.get('firstName')?.trim() ?? '';
    const lastName = params.get('lastName')?.trim() ?? '';
    if (!firstName || !lastName) return NextResponse.json({ account: null });

    const account = await findOrphanedLaunchAccount({ firstName, lastName });
    return NextResponse.json({ account });
  },
  { deniedAction: 'ADMIN_USERS_VIEW_DENIED', deniedCategory: 'USER' },
);
