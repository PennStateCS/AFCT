/**
 * The queue of messages on their way out.
 *
 * This exists for one reason that is not "reliability", though it gives that too. The
 * password-reset endpoint has to answer identically whether or not the address has an account,
 * and *identically* includes how long it takes. An address with no account did a database lookup
 * and returned; an address with one did a lookup, made a token, then opened a TCP connection,
 * negotiated TLS, authenticated and sent a message before returning. Anyone could tell those two
 * apart with a stopwatch, which turns a deliberately silent endpoint into an account-enumeration
 * oracle.
 *
 * Queueing moves the whole variable part after the response. What is left in the request is a
 * row insert, which is the same work either way.
 *
 * Shaped after `lti/score-queue`, deliberately: the claim-and-back-off pattern is already in the
 * codebase and there is no reason for a second one that reads differently.
 */

import { prisma } from '@/lib/prisma';
import type { MailState, Prisma } from '@prisma/client';
import { encryptSecret, readStoredSecret } from '@/lib/secret-encryption';
import { hashSingleUseToken } from '@/lib/single-use-token';

/** Give up after this many tries and leave it for somebody to look at. */
export const MAX_ATTEMPTS = 5;

/** Backoff between attempts, in minutes. A reset link outlives this comfortably. */
const BACKOFF_MINUTES = [1, 5, 15, 30];

export type QueuedMail = {
  to: string;
  subject: string;
  text: string;
  /**
   * The single-use token the body carries, when it carries one. Stored as its hash so a retry
   * can check the link still works before sending it.
   */
  token?: string;
  tx?: Prisma.TransactionClient;
};

/**
 * Put a message on the queue.
 *
 * Takes a transaction client so the message and whatever it is about can be written together.
 * A reset token that exists without its email, or an email promising a token that was rolled
 * back, are both worse than neither.
 */
export async function queueMail(message: QueuedMail): Promise<{ id: string }> {
  const client = message.tx ?? prisma;
  const row = await client.mailQueue.create({
    data: {
      toAddress: message.to,
      subject: message.subject,
      bodyEncrypted: encryptSecret(message.text),
      tokenHash: message.token ? hashSingleUseToken(message.token) : null,
    },
    select: { id: true },
  });
  return row;
}

/**
 * How long a claim holds a message before another sender may take it.
 *
 * Doubles as crash recovery: a sender that dies mid-send leaves the row claimed, and this is how
 * long before somebody picks it up again. Long enough that a slow SMTP conversation finishes
 * first, short enough that a reset link is not stranded.
 */
const CLAIM_LEASE_MS = 5 * 60 * 1000;

/**
 * Take the next message to send, reserving it.
 *
 * Bumping `attempts` alone is not a reservation: the row stays `PENDING` and due, so a second
 * caller reads it, sees the new attempt count, and claims it too. The lease is what actually
 * makes this exclusive, by pushing the row out of the due window for as long as the send should
 * take. A sender that crashes holding one simply lets the lease lapse.
 */
export async function claimNextMail(now = new Date()) {
  const candidate = await prisma.mailQueue.findFirst({
    where: { state: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    select: { id: true, attempts: true },
  });
  if (!candidate) return null;

  const { count } = await prisma.mailQueue.updateMany({
    // Both guards matter: `attempts` catches a racing claim, and `nextAttemptAt` is what the
    // winner moves, so a loser arriving afterwards matches nothing.
    where: {
      id: candidate.id,
      state: 'PENDING',
      attempts: candidate.attempts,
      nextAttemptAt: { lte: now },
    },
    data: {
      attempts: candidate.attempts + 1,
      nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS),
    },
  });
  if (count !== 1) return null;

  const claimed = await prisma.mailQueue.findUnique({ where: { id: candidate.id } });
  if (!claimed) return null;

  return {
    id: claimed.id,
    to: claimed.toAddress,
    subject: claimed.subject,
    /** Decrypted here and nowhere else. Never logged, never returned by an API. */
    text: readStoredSecret(claimed.bodyEncrypted) ?? '',
    tokenHash: claimed.tokenHash,
    attempts: claimed.attempts,
  };
}

/** Mark a queued message as delivered, and drop the body: it has served its purpose. */
export async function markMailSent(id: string, now = new Date()): Promise<void> {
  await prisma.mailQueue.update({
    where: { id },
    data: {
      state: 'SENT',
      sentAt: now,
      lastError: null,
      // The link is out of AFCT's hands and the row no longer needs to hold a working key to
      // somebody's account.
      bodyEncrypted: '',
    },
  });
}

/**
 * Record a failed attempt, scheduling a retry or giving up.
 *
 * `retryable` is the difference between a mail server that is busy and one that is refusing us.
 * A rejected password will be rejected again in five minutes; a refused connection is worth
 * waiting on.
 */
export async function markMailFailed(opts: {
  id: string;
  attempts: number;
  error: string;
  retryable: boolean;
  now?: Date;
}): Promise<{ state: MailState }> {
  const now = opts.now ?? new Date();
  const giveUp = opts.attempts >= MAX_ATTEMPTS || !opts.retryable;
  const minutes = BACKOFF_MINUTES[Math.min(opts.attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 1;

  await prisma.mailQueue.update({
    where: { id: opts.id },
    data: {
      state: giveUp ? 'FAILED' : 'PENDING',
      lastError: opts.error.slice(0, 500),
      nextAttemptAt: new Date(now.getTime() + minutes * 60_000),
      // Nothing more will be sent, so the body goes the same way as a delivered one.
      ...(giveUp ? { bodyEncrypted: '' } : {}),
    },
  });

  return { state: giveUp ? 'FAILED' : 'PENDING' };
}

/**
 * Abandon a message whose reason for existing has gone.
 *
 * A queued reset whose token has been spent or has expired must not be sent: the person either
 * already recovered their account or waited too long, and either way the link in that email is
 * dead. Sending it anyway is a confusing message with a useless link in it.
 */
export async function abandonMail(id: string, why: string): Promise<void> {
  await prisma.mailQueue.update({
    where: { id },
    data: { state: 'FAILED', lastError: why, bodyEncrypted: '' },
  });
}

/** Sweep delivered and abandoned messages. Called by the job that prunes the other tables. */
export async function purgeSentMail(graceMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  const { count } = await prisma.mailQueue.deleteMany({
    where: { state: { in: ['SENT', 'FAILED'] }, updatedAt: { lt: new Date(Date.now() - graceMs) } },
  });
  return count;
}
