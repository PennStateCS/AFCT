import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAdminAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { logError } from '@/lib/api/activity';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { MailError, sendTestEmail } from '@/lib/mailer';
import { SendTestEmailSchema } from '@/schemas/smtp';

/**
 * Sends a test message using the stored mail settings.
 *
 * Exists so mail is proved working at the moment an admin configures it, rather than the first
 * time a student cannot get back into their account. It reads the saved settings rather than
 * anything in the request body, so what it proves is what the site will actually do.
 * @openapi
 * summary: Send a test email using the stored mail settings
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [to]
 *         properties:
 *           to: { type: string, format: email, description: Where to send the test message }
 * responses:
 *   200: { description: The message was accepted by the mail server. }
 *   400: { description: "Bad body, or mail is not configured." }
 *   401: { description: Not signed in. }
 *   403: { description: Not a system administrator. }
 *   500: { description: Server error. }
 */
export const POST = withAdminAuth(
  async (req, _ctx, { user }) => {
    const parsed = await readJson(req, SendTestEmailSchema);
    if (!parsed.ok) return parsed.response;
    const { to } = parsed.data;

    try {
      await sendTestEmail(to);
    } catch (error) {
      if (error instanceof MailError) {
        // A misconfiguration, not a server fault. The message already says what to change,
        // so it goes straight to the admin who asked.
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'TEST_EMAIL_FAILED',
          severity: 'WARNING',
          category: 'SYSTEM',
          metadata: { recipient: to, reason: error.message },
        });
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      console.error('POST /api/admin/settings/test-email error:', error);
      await logError(req, {
        userId: user.id,
        action: 'TEST_EMAIL_ERROR',
        category: 'SYSTEM',
        error,
      });
      return NextResponse.json({ error: 'Failed to send the test message.' }, { status: 500 });
    }

    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'TEST_EMAIL_SENT',
      severity: 'INFO',
      category: 'SYSTEM',
      metadata: { recipient: to },
    });

    return NextResponse.json({ ok: true });
  },
  { deniedAction: 'TEST_EMAIL_DENIED', deniedCategory: 'SYSTEM' },
);
