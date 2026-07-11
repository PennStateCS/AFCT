import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logError } from '@/lib/api/activity';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { normalizeEmail } from '@/lib/email';
import { BulkEnrollEmailsSchema } from '@/schemas/bulk';

/**
 * Resolves a list of emails to user records, splitting them into `found` and
 * `notFound` — used by the roster importer to preview who exists before enrolling.
 * Matching is case-insensitive regardless of DB collation. Restricted to course
 * staff (faculty or TAs) or a system admin: only someone who can manage the course
 * in the path may resolve emails to accounts.
 * @openapi
 * summary: Look up users by email
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
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
 *   403: { description: Not course staff (faculty or TAs) or a system admin. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req) => {
    try {
      const parsed = await readJson(req, BulkEnrollEmailsSchema);
      if (!parsed.ok) return parsed.response;
      const emails: string[] = parsed.data.emails.map((e) => normalizeEmail(e)).filter(Boolean);
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
      await logError(req, {
        userId: null,
        action: 'COURSE_LOOKUP_USERS_ERROR',
        error: err,
      });
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'COURSE_LOOKUP_USERS_DENIED' },
);
