import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import { getUsersList } from '@/lib/users-list';
import { withAdminAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { isValidEmail } from '@/lib/email';
import { isStrongPassword } from '@/lib/password-policy';
import { UserCreateApiSchema } from '@/schemas/user';
import { readAdoptableAccount } from '@/lib/lti/jit-duplicates';
import { isWriteConflict } from '@/lib/linked-identity';
import { Prisma } from '@prisma/client';

/**
 * Lists users for the admin-facing users table. System administrators only; the
 * access itself is audited.
 * @openapi
 * summary: List users
 * responses:
 *   200:
 *     description: Users.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   403: { description: System administrators only. }
 *   500: { description: Server error. }
 */
export const GET = withAdminAuth(
  async (req, _ctx, { user }) => {
    try {
      const users = await getUsersList();

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'VIEW_USERS',
        severity: 'INFO',
        category: 'USER',
        metadata: {},
      });

      return NextResponse.json(users);
    } catch (error) {
      console.error('[USERS_GET_ERROR]', error);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }
  },
  { deniedAction: 'ADMIN_USERS_VIEW_DENIED' },
);

/**
 * Creates a single user directly (admin-provisioned account), unlike self-service
 * signup. System administrators only. Validates email, password strength, and
 * timezone, and rejects a duplicate email. The account is created with no global
 * role; admin rights are granted separately via the isAdmin flag.
 * @openapi
 * summary: Create a user
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [email, firstName, lastName, password]
 *         properties:
 *           email: { type: string }
 *           firstName: { type: string }
 *           lastName: { type: string }
 *           password: { type: string, description: Must meet the strength policy }
 *           timezone: { type: string, description: Defaults to the system timezone }
 * responses:
 *   201:
 *     description: The created user.
 *   400: { description: "Missing fields, invalid email, weak password, or invalid timezone." }
 *   403: { description: System administrators only. }
 *   409: { description: Email already in use. }
 *   500: { description: Server error. }
 */
export const POST = withAdminAuth(
  async (req, _ctx, { user }) => {
    try {
      const parsed = await readJson(req, UserCreateApiSchema);
      if (!parsed.ok) return parsed.response;
      const { email, firstName, lastName, password, timezone, adoptLaunchAccountId } = parsed.data;

      if (!isValidEmail(email)) {
        console.warn(`[USERS_POST] Invalid email format: ${email}`);
        return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
      }

      if (!isStrongPassword(password)) {
        console.warn('[USERS_POST] Weak password provided');
        return NextResponse.json(
          {
            error:
              'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.',
          },
          { status: 400 },
        );
      }

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        console.warn(`[USERS_POST] Email already in use: ${email}`);
        return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      if (timezone && !COMMON_TIMEZONES.includes(timezone as (typeof COMMON_TIMEZONES)[number])) {
        return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
      }

      // Only the fallback timezone for the new account is needed here.
      const systemSettings = await prisma.systemSettings.findUnique({
        where: { id: 1 },
        select: { timezone: true },
      });

      const newUserData = {
        email,
        firstName,
        lastName,
        password: hashedPassword,
        timezone: timezone || systemSettings?.timezone || 'UTC',
      };
      const newUserFields = {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        timezone: true,
      } as const;

      let newUser;
      /** Set when an LMS sign-in was moved, so the response can say what became of the old one. */
      let adopted: { fromEmail: string } | null = null;

      try {
        if (!adoptLaunchAccountId) {
          // The unique index on email is the real guard, so a clash is answered here rather than
          // pre-checked: an admin adding an address that already has an account should be told
          // so, not shown a server error.
          newUser = await prisma.user.create({ data: newUserData, select: newUserFields });
        } else {
          /**
           * Creating the account and moving the sign-in are one transaction, so a refusal
           * leaves nothing behind. Answering 201 with "but the adoption failed" would be read
           * as success and the duplicate would survive, which is the whole problem.
           *
           * Serializable for the same reason the promotion path is: this reads the old
           * account's identities and then writes its user row, and an automatic link landing on
           * it in between would otherwise be lost. That pair of statements is the cycle.
           */
          const result = await prisma.$transaction(
            async (tx) => {
              const orphan = await readAdoptableAccount(adoptLaunchAccountId, tx);
              // Asked again here rather than trusted from the lookup: a person read that
              // warning and then decided, and anything it depends on can have changed since.
              if (!orphan) return { stale: true as const };

              const created = await tx.user.create({ data: newUserData, select: newUserFields });

              await tx.linkedIdentity.update({
                where: { id: orphan.identityId },
                data: {
                  userId: created.id,
                  // No longer just-in-time: an administrator attached this, which is both true
                  // and load-bearing. `JUST_IN_TIME` counts as an automatic link, and promoting
                  // somebody to administrator deletes every automatic link they have, which
                  // would silently sever the very sign-in this is preserving.
                  linkedVia: 'ADMIN',
                },
              });

              // Retired rather than deleted: deletion is not reversible, and the activity log
              // still points at it. The response tells the administrator it can now go.
              await tx.user.update({
                where: { id: orphan.userId },
                data: { inactive: true },
              });

              return { stale: false as const, created, orphan };
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          );

          if (result.stale) {
            return NextResponse.json(
              {
                error:
                  'That LMS account can no longer be moved. It may have been used since, or already connected elsewhere. Create the account on its own and check the sign-in methods.',
              },
              { status: 409 },
            );
          }

          newUser = result.created;
          adopted = { fromEmail: result.orphan.email };

          await createEnhancedActivityLog(prisma, req, {
            userId: user.id,
            action: 'USER_IDENTITY_REASSIGNED',
            // A deliberate administrator action with real consequences, which is WARNING here.
            // SECURITY is for refusals and violations, and this is neither.
            severity: 'WARNING',
            category: 'USER',
            metadata: {
              fromUserId: result.orphan.userId,
              fromUserEmail: result.orphan.email,
              targetUserId: result.created.id,
              targetUserEmail: result.created.email,
              identityId: result.orphan.identityId,
              issuer: result.orphan.issuer,
              kind: 'LTI',
              orphanDeactivated: true,
            },
          });
        }
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Same message as the pre-check above: one condition, one thing said about it.
          return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
        }
        if (isWriteConflict(err)) {
          return NextResponse.json(
            { error: 'That account was being changed at the same time. Try again.' },
            { status: 409 },
          );
        }
        throw err;
      }

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'CREATE_USER',
        severity: 'INFO',
        category: 'USER',
        metadata: {
          createdUserId: newUser.id,
          createdUserEmail: newUser.email,
        },
      });

      return NextResponse.json({ ...newUser, adopted }, { status: 201 });
    } catch (error) {
      console.error('[USERS_POST_ERROR]', error);
      await logError(req, {
        userId: user.id,
        action: 'USER_CREATE_ERROR',
        category: 'USER',
        error,
      });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
  { deniedAction: 'USER_CREATE_DENIED' },
);
