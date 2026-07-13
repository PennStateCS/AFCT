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
      const { email, firstName, lastName, password, timezone } = parsed.data;

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

      const systemSettings = await prisma.systemSettings.findUnique({ where: { id: 1 } });

      const newUser = await prisma.user.create({
        data: {
          email,
          firstName,
          lastName,
          password: hashedPassword,
          timezone: timezone || systemSettings?.timezone || 'UTC',
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          createdAt: true,
          timezone: true,
        },
      });

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

      return NextResponse.json(newUser, { status: 201 });
    } catch (error) {
      console.error('[USERS_POST_ERROR]', error);
      await logError(req, {
        userId: user.id,
        action: 'USER_CREATE_ERROR',
        error,
      });
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
  { deniedAction: 'USER_CREATE_DENIED' },
);
