import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { queueMail, claimNextMail, markMailFailed, MAX_ATTEMPTS } from './mail-queue';
import { sendOneMail } from './mail-sender';
import { issueSingleUseToken, consumeSingleUseToken } from './single-use-token';
import { encryptSecret, SECRET_KEY_ENV } from './secret-encryption';

/**
 * The mail queue, against a real Postgres.
 *
 * The queue exists for a security reason rather than a reliability one, and it is worth being
 * clear which property each test is about. The password-reset endpoint must take the same time
 * whether or not the address has an account; it cannot, while it is holding an SMTP conversation
 * open. Queueing moves that work after the response.
 *
 * Rather than assert on a stopwatch, which is flaky and proves little, these test the shape that
 * makes the timing equal: the request writes a row and stops, and everything variable happens in
 * the sender.
 */

const sendMailMock = vi.hoisted(() => vi.fn());
const retryableMock = vi.hoisted(() => vi.fn(() => true));
vi.mock('@/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock, isRetryableMailFailure: retryableMock };
});

const USER = 'u-mailq';

async function destroyFixtures() {
  await prisma.mailQueue.deleteMany({});
  await prisma.singleUseToken.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  process.env[SECRET_KEY_ENV] ??= 'k'.repeat(48);
  sendMailMock.mockResolvedValue(undefined);
  retryableMock.mockReturnValue(true);
  await destroyFixtures();
  await prisma.user.create({ data: { id: USER, email: 'mailq@example.test', password: null } });
});

afterEach(() => vi.clearAllMocks());

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

const queue = (over: { to?: string; text?: string; token?: string } = {}) =>
  queueMail({
    to: over.to ?? 'mailq@example.test',
    subject: 'Reset your AFCT password',
    text: over.text ?? 'open https://afct.test/reset-password?token=abc',
    token: over.token,
  });

describe('what queueing writes', () => {
  it('stores the body encrypted rather than in the clear', async () => {
    await queue({ text: 'a link nobody else should read' });

    const row = await prisma.mailQueue.findFirstOrThrow();
    expect(row.bodyEncrypted).not.toContain('a link nobody else should read');
    // Readable again by the sender, which is the only thing that reads it.
    expect((await claimNextMail())?.text).toBe('a link nobody else should read');
  });

  /**
   * The hash, not the token. The same value is already the only stored form of the token, so
   * this adds no new secret to the database while still letting a retry check the link works.
   */
  it('stores the token as its hash, never as itself', async () => {
    await queue({ token: 'the-plaintext-token' });

    const row = await prisma.mailQueue.findFirstOrThrow();
    expect(row.tokenHash).toHaveLength(64);
    expect(row.tokenHash).not.toBe('the-plaintext-token');
  });
});

describe('claiming work', () => {
  it('hands one message to one sender', async () => {
    await queue();

    const [first, second] = await Promise.all([claimNextMail(), claimNextMail()]);

    // Exactly one wins. Both claiming would send the same message twice.
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it('says there is nothing to do when the queue is empty', async () => {
    expect(await claimNextMail()).toBeNull();
  });
});

describe('sending', () => {
  it('marks a delivered message sent and drops the body', async () => {
    await queue();

    expect(await sendOneMail()).toEqual({ status: 'sent' });

    const row = await prisma.mailQueue.findFirstOrThrow();
    expect(row.state).toBe('SENT');
    expect(row.sentAt).not.toBeNull();
    // The link is out of AFCT's hands; the row no longer needs to hold a key to an account.
    expect(row.bodyEncrypted).toBe('');
  });

  it('leaves a temporary failure pending, to try again later', async () => {
    await queue();
    sendMailMock.mockRejectedValue(Object.assign(new Error('busy'), { code: 'ETIMEDOUT' }));

    expect(await sendOneMail()).toMatchObject({ status: 'failed', retryable: true });

    const row = await prisma.mailQueue.findFirstOrThrow();
    expect(row.state).toBe('PENDING');
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  // A rejected password will be rejected again. Retrying for a day helps nobody.
  it('gives up at once on a failure that will not improve', async () => {
    await queue();
    retryableMock.mockReturnValue(false);
    sendMailMock.mockRejectedValue(Object.assign(new Error('no'), { code: 'EAUTH' }));

    expect(await sendOneMail()).toMatchObject({ status: 'failed', retryable: false });
    expect((await prisma.mailQueue.findFirstOrThrow()).state).toBe('FAILED');
  });

  it('gives up once the attempts run out', async () => {
    const { id } = await queue();

    await markMailFailed({ id, attempts: MAX_ATTEMPTS, error: 'still failing', retryable: true });

    expect((await prisma.mailQueue.findFirstOrThrow()).state).toBe('FAILED');
  });

  /**
   * A failure must not repeat a credential back into the queue row, which is read by the same
   * screens as the activity log.
   */
  it('records a reason without repeating whatever the transport said', async () => {
    await queue();
    retryableMock.mockReturnValue(false);
    sendMailMock.mockRejectedValue(new Error('AUTH failed for afct/hunter2'));

    await sendOneMail();

    expect((await prisma.mailQueue.findFirstOrThrow()).lastError).not.toContain('hunter2');
  });
});

/**
 * A queued reset is only worth sending while the link in it still works.
 *
 * Retries make this real rather than theoretical: the first attempt fails, the person recovers
 * their account another way, and the retry would post them a link that does nothing.
 */
describe('a message whose link has stopped working', () => {
  const queueWithLiveToken = async () => {
    const { token } = await issueSingleUseToken({
      purpose: 'PASSWORD_RESET',
      userId: USER,
      ttlMs: 60 * 60 * 1000,
    });
    await queue({ token });
    return token;
  };

  it('sends while the link is still good', async () => {
    await queueWithLiveToken();

    expect(await sendOneMail()).toEqual({ status: 'sent' });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('is abandoned once the link has been used', async () => {
    const token = await queueWithLiveToken();
    await consumeSingleUseToken({ token, purpose: 'PASSWORD_RESET' });

    expect(await sendOneMail()).toMatchObject({ status: 'abandoned' });
    expect(sendMailMock).not.toHaveBeenCalled();
    expect((await prisma.mailQueue.findFirstOrThrow()).state).toBe('FAILED');
  });

  it('is abandoned once the link has expired', async () => {
    const { token } = await issueSingleUseToken({
      purpose: 'PASSWORD_RESET',
      userId: USER,
      ttlMs: -1000,
    });
    await queue({ token });

    expect(await sendOneMail()).toMatchObject({ status: 'abandoned' });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  // A retry must reuse the token that was issued, never mint a second one.
  it('reuses the same link across a retry rather than issuing another', async () => {
    await queueWithLiveToken();
    sendMailMock.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'ETIMEDOUT' }));

    await sendOneMail();
    await prisma.mailQueue.updateMany({ data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await sendOneMail();

    expect(await prisma.singleUseToken.count({ where: { userId: USER } })).toBe(1);
    expect((await prisma.mailQueue.findFirstOrThrow()).state).toBe('SENT');
  });
});

/**
 * The enumeration property, tested as architecture rather than with a stopwatch.
 *
 * What used to differ between an address with an account and one without was an entire SMTP
 * conversation. Now the only difference is a row insert, and the send happens in a process
 * nobody is waiting on.
 */
describe('what the request does and does not wait for', () => {
  it('does not touch the mail server while queueing', async () => {
    await queue();

    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('only reaches the mail server when the sender runs', async () => {
    await queue();

    await sendOneMail();

    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });
});

/** A body should never be readable from a row once it has nothing left to do. */
describe('what is left behind', () => {
  it('keeps no body on an abandoned message', async () => {
    const { token } = await issueSingleUseToken({
      purpose: 'PASSWORD_RESET',
      userId: USER,
      ttlMs: -1000,
    });
    await queue({ token });

    await sendOneMail();

    expect((await prisma.mailQueue.findFirstOrThrow()).bodyEncrypted).toBe('');
  });

  it('encrypts with the key rather than encoding', async () => {
    await queue({ text: 'plain' });

    const row = await prisma.mailQueue.findFirstOrThrow();
    expect(row.bodyEncrypted).not.toBe('plain');
    expect(row.bodyEncrypted).not.toBe(Buffer.from('plain').toString('base64'));
    expect(row.bodyEncrypted).not.toBe(encryptSecret('plain'));
  });
});
