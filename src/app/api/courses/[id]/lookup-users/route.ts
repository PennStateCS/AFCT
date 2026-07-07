import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

/**
 * Resolves a list of emails to user records, splitting them into `found` and
 * `notFound` — used by the roster importer to preview who exists before enrolling.
 * Matching is case-insensitive regardless of DB collation. Requires a signed-in
 * user (the courseId in the path isn't used to scope results).
 * @openapi
 * summary: Look up users by email
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [emails]
 *         properties:
 *           emails: { type: array, items: { type: string } }
 * responses:
 *   200:
 *     description: Matched users and the emails with no match.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             found: { type: array, items: { type: object } }
 *             notFound: { type: array, items: { type: string } }
 *   401: { description: Not signed in. }
 *   500: { description: Server error. }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const emails: string[] = (body?.emails ?? []).map((e: string) => String(e).trim().toLowerCase()).filter(Boolean);
    if (!emails.length) return NextResponse.json({ found: [], notFound: [] });

    // Find users whose email matches (case-insensitive)
    // Use OR with equals + mode: 'insensitive' so matching does not depend on DB collation.
    const users = await prisma.user.findMany({
      where: {
        OR: emails.map((e: string) => ({ email: { equals: e, mode: 'insensitive' } })),
      },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    const foundEmails = new Set(users.map((u: (typeof users)[number]) => u.email.toLowerCase()));
    const notFound = emails.filter((e: string) => !foundEmails.has(e));

    return NextResponse.json({ found: users, notFound }, { status: 200 });
  } catch (err) {
    console.error('lookup-users error', err);
    await createEnhancedActivityLog(prisma, req, {
      userId: null,
      action: 'COURSE_LOOKUP_USERS_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
