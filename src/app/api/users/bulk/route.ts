import { NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { isStrongPassword, passwordRequirementText } from '@/lib/password-policy';

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

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

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || !['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const rows = (body?.rows ?? []) as BulkUserRow[];
    const temporaryPasswords = body?.temporaryPasswords === true;

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
    }

    const created: CreatedRow[] = [];
    const failed: FailedRow[] = [];

    const systemSettings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    const defaultTimezone = systemSettings?.timezone || 'UTC';

    const seenInBatch = new Set<string>();

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] ?? {};
      const rowNumber = typeof row.rowNumber === 'number' ? row.rowNumber : index + 2;

      const firstName = (row.firstName ?? '').trim();
      const lastName = (row.lastName ?? '').trim();
      const email = (row.email ?? '').trim().toLowerCase();
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

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
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
            role: 'STUDENT',
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
      userId: session.user.id,
      action: 'BULK_CREATE_USERS',
      severity: 'INFO',
      category: 'USER',
      metadata: {
        userId: session.user.id,
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
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
