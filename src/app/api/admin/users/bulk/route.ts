import { NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { isStrongPassword, passwordRequirementText } from '@/lib/password-policy';
import { withAdminAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { normalizeEmail, isValidEmail } from '@/lib/email';
import { BulkImportUsersSchema } from '@/schemas/bulk';

type BulkUserRow = {
  rowNumber?: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
};

type FailedRow = {
  row: number;
  email: string | null;
  reason: string;
};

type CreatedRow = {
  row: number;
  email: string;
  userId: string;
};

/**
 * Bulk-creates user accounts from parsed spreadsheet rows (the CSV import flow).
 * System administrators only. Accounts are created with no global role. Each row
 * is validated independently: a bad row
 * is collected in `failed` with a reason rather than aborting the batch, so the
 * response always reports per-row created/failed outcomes. Duplicate emails are
 * caught both within the batch and against existing users. `temporaryPasswords`
 * forces a reset at first login.
 * @openapi
 * summary: Bulk-create users
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [rows]
 *         properties:
 *           rows:
 *             type: array
 *             items:
 *               type: object
 *               properties:
 *                 rowNumber: { type: integer, description: "Source spreadsheet row, for error reporting" }
 *                 firstName: { type: string }
 *                 lastName: { type: string }
 *                 email: { type: string }
 *                 password: { type: string }
 *           temporaryPasswords: { type: boolean, description: Force a password change at first login }
 * responses:
 *   200:
 *     description: Per-row outcome (a summary plus created and failed lists).
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             summary:
 *               type: object
 *               properties:
 *                 total: { type: integer }
 *                 created: { type: integer }
 *                 failed: { type: integer }
 *             created: { type: array, items: { type: object } }
 *             failed: { type: array, items: { type: object } }
 *   400: { description: No rows provided. }
 *   403: { description: System administrators only. }
 *   500: { description: Server error. }
 */
export const POST = withAdminAuth(
  async (req, _ctx, { user }) => {
    try {
      const parsed = await readJson(req, BulkImportUsersSchema);
      if (!parsed.ok) return parsed.response;
      const rows = parsed.data.rows as BulkUserRow[];
      const temporaryPasswords = parsed.data.temporaryPasswords === true;

      if (rows.length === 0) {
        return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
      }

      const created: CreatedRow[] = [];
      const failed: FailedRow[] = [];

      const systemSettings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
      const defaultTimezone = systemSettings?.timezone || 'UTC';

      const seenInBatch = new Set<string>();

      // Pre-fetch which of the submitted emails already exist in ONE query, instead
      // of a findUnique per row (an N+1 that scaled with the CSV size).
      const candidateEmails = Array.from(
        new Set(rows.map((r) => normalizeEmail(r?.email)).filter((e) => e.length > 0)),
      );
      const existingEmails = new Set(
        candidateEmails.length > 0
          ? (
              await prisma.user.findMany({
                where: { email: { in: candidateEmails } },
                select: { email: true },
              })
            ).map((u) => u.email)
          : [],
      );

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index] ?? {};
        const rowNumber = typeof row.rowNumber === 'number' ? row.rowNumber : index + 2;

        const firstName = (row.firstName ?? '').trim();
        const lastName = (row.lastName ?? '').trim();
        const email = normalizeEmail(row.email);
        const password = String(row.password ?? '').trim();

        if (!firstName || !lastName || !email || !password) {
          failed.push({
            row: rowNumber,
            email: email || null,
            reason: 'Missing required data',
          });
          continue;
        }

        if (!isValidEmail(email)) {
          failed.push({
            row: rowNumber,
            email,
            reason: 'Invalid email format',
          });
          continue;
        }

        if (!isStrongPassword(password)) {
          failed.push({
            row: rowNumber,
            email,
            reason: passwordRequirementText,
          });
          continue;
        }

        if (seenInBatch.has(email)) {
          failed.push({
            row: rowNumber,
            email,
            reason: 'Username already exists',
          });
          continue;
        }

        if (existingEmails.has(email)) {
          failed.push({
            row: rowNumber,
            email,
            reason: 'Username already exists',
          });
          continue;
        }

        try {
          const hashedPassword = await bcrypt.hash(password, 10);
          const newUser = await prisma.user.create({
            data: {
              firstName,
              lastName,
              email,
              password: hashedPassword,
              temporaryPassword: temporaryPasswords,
              timezone: defaultTimezone,
            },
            select: { id: true, email: true },
          });

          seenInBatch.add(email);
          created.push({
            row: rowNumber,
            email: newUser.email,
            userId: newUser.id,
          });
        } catch {
          failed.push({
            row: rowNumber,
            email,
            reason: 'Failed to create user',
          });
        }
      }

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'BULK_CREATE_USERS',
        severity: 'INFO',
        category: 'USER',
        metadata: {
          totalRows: rows.length,
          createdCount: created.length,
          failedCount: failed.length,
        },
      });

      return NextResponse.json({
        summary: {
          total: rows.length,
          created: created.length,
          failed: failed.length,
        },
        created,
        failed,
      });
    } catch (error) {
      console.error('[USERS_BULK_POST_ERROR]', error);
      await logError(req, {
        userId: user.id,
        action: 'USER_BULK_CREATE_ERROR',
        error,
      });
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
  { deniedAction: 'USER_BULK_CREATE_DENIED' },
);
