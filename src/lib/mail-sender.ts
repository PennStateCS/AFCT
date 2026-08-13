/**
 * Draining the mail queue.
 *
 * Runs in the app container on an interval, the same way the grade sender does. Nothing here
 * talks to a user: by the time this runs, the request that queued the message has long since
 * been answered, which is the entire point.
 */

import { prisma } from '@/lib/prisma';
import {
  claimNextMail,
  markMailSent,
  markMailFailed,
  abandonMail,
  readQueuedBody,
} from '@/lib/mail-queue';
import { sendMail, MailError, isRetryableMailFailure } from '@/lib/mailer';

/** How often to look for work. Short: somebody is waiting on a reset link. */
const SEND_INTERVAL_MS = 15_000;

let started = false;

export type MailOutcome =
  | { status: 'idle' }
  | { status: 'sent' }
  | { status: 'abandoned'; reason: string }
  | { status: 'failed'; retryable: boolean };

/**
 * Send at most one queued message.
 *
 * Returns rather than throws, so the loop carries on. A message that cannot be sent stays in the
 * queue with the reason on it rather than disappearing.
 */
export async function sendOneMail(): Promise<MailOutcome> {
  const claimed = await claimNextMail();
  if (!claimed) return { status: 'idle' };

  /**
   * A message carrying a single-use token is only worth sending while that token still works.
   *
   * Retries make this a real case rather than a theoretical one: the first attempt can fail, the
   * person can recover their account another way an hour later, and the retry would then post
   * them a link that does nothing. Checked against the token's own row, so a token spent or
   * expired between queueing and sending stops the message.
   */
  if (claimed.tokenHash) {
    const token = await prisma.singleUseToken.findUnique({
      where: { tokenHash: claimed.tokenHash },
      select: { usedAt: true, expiresAt: true },
    });
    if (!token || token.usedAt || token.expiresAt.getTime() <= Date.now()) {
      const why = 'the link it carried was already used or had expired';
      await abandonMail(claimed.id, why);
      return { status: 'abandoned', reason: why };
    }
  }

  /**
   * A body that cannot be read is finished, not delayed.
   *
   * It means the key has changed under it, or a backup was restored with a different one. No
   * number of retries recovers that, and the row would otherwise be claimed and abandoned every
   * five minutes for ever, because the attempt limit only applies to failures that get as far as
   * being recorded.
   */
  const text = readQueuedBody(claimed);
  if (text === null) {
    const why = 'the queued message could not be read, which usually means the secret key changed';
    await abandonMail(claimed.id, why);
    return { status: 'abandoned', reason: why };
  }

  try {
    await sendMail({ to: claimed.to, subject: claimed.subject, text });
  } catch (error) {
    const retryable = isRetryableMailFailure(error);
    await markMailFailed({
      id: claimed.id,
      attempts: claimed.attempts,
      // `MailError` messages are written for administrators and carry no credentials; anything
      // else is reduced to its class rather than its text, which is where a library could
      // otherwise echo a connection string back at us.
      error: error instanceof MailError ? error.message : 'The message could not be sent.',
      retryable,
    });
    return { status: 'failed', retryable };
  }

  await markMailSent(claimed.id);
  return { status: 'sent' };
}

async function loop(): Promise<void> {
  for (;;) {
    try {
      // Keep going while there is work, so a backlog drains rather than trickling one message
      // per interval.
      let outcome = await sendOneMail();
      while (outcome.status !== 'idle') outcome = await sendOneMail();
    } catch (error) {
      // Never let one bad row stop the loop for the lifetime of the process.
      console.error('[mail] sender loop error:', error);
    }
    await new Promise((resolve) => setTimeout(resolve, SEND_INTERVAL_MS));
  }
}

/** Start the sender once per process. */
export function startMailSender(): void {
  if (started) return;
  started = true;
  void loop();
}
