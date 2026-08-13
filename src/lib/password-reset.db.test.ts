import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';

import { completePasswordReset, requestPasswordReset } from './password-reset';
import { hashSingleUseToken } from './single-use-token';
import { readStoredSecret } from './secret-encryption';

/**
 * Password reset, against a real Postgres.
 *
 * The rules here are mostly about what must *not* happen after a link is used: it must not work
 * twice, every other outstanding link must stop working, and the account's existing sessions and
 * client tokens must stop being honoured. Those are transactional and concurrent properties, so
 * a mock would only prove the mock.
 *
 * Nothing is mocked at all now. Requesting a reset writes a row to the mail queue rather than
 * opening an SMTP connection, so the email can be read out of the database like everything else,
 * and the tests exercise the real path a message takes.
 */

const SUFFIX = 'pwrint';
const ids = { user: `u-${SUFFIX}`, other: `u2-${SUFFIX}` };
const EMAIL = `${SUFFIX}@example.test`;
const NEW_PASSWORD = 'Str0ng!NewPass1';

async function destroyFixtures() {
  await prisma.mailQueue.deleteMany({});
  await prisma.singleUseToken.deleteMany({ where: { userId: { in: [ids.user, ids.other] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.user, ids.other] } } });
}

/** Every message waiting to go out, oldest first. */
const queuedMail = () => prisma.mailQueue.findMany({ orderBy: { createdAt: 'asc' } });

/** The body of a queued message, which is stored encrypted for the same reason the token is. */
const bodyOf = (row: { bodyEncrypted: string }) => readStoredSecret(row.bodyEncrypted) ?? '';

async function seedFixtures() {
  await prisma.user.create({
    data: {
      id: ids.user,
      email: EMAIL,
      firstName: 'Reset',
      lastName: 'Fixture',
      password: await bcrypt.hash('OldPassw0rd!', 10),
    },
  });
}

/**
 * The stored hash, asserted present.
 *
 * `User.password` is optional now, because an account can be vouched for by an identity
 * provider instead. None of these fixtures is such an account, so a missing hash here would
 * itself be the bug, and asserting it says so rather than quietly coercing the type away.
 */
const storedHash = async (userId: string): Promise<string> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  expect(user?.password).toBeTruthy();
  return user!.password!;
};

/** The token out of a queued email, which is the only place the plaintext ever exists. */
const tokenIn = (row: { bodyEncrypted: string }): string =>
  new URL(bodyOf(row).match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;

/** The token out of the most recent email. */
const tokenFromLastEmail = async (): Promise<string> => tokenIn((await queuedMail()).at(-1)!);

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = 'https://afct.test';
  await destroyFixtures();
  await seedFixtures();
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('requesting a link', () => {
  it('queues a link to a real account', async () => {
    const { sent } = await requestPasswordReset(EMAIL);

    expect(sent).toBe(true);
    expect(await queuedMail()).toMatchObject([{ toAddress: EMAIL, state: 'PENDING' }]);
  });

  it('queues nothing for an address with no account', async () => {
    const { sent } = await requestPasswordReset('nobody@example.test');

    expect(sent).toBe(false);
    expect(await queuedMail()).toHaveLength(0);
  });

  // An administrator turned the account off. A reset link would be a way back in.
  it('queues nothing for a disabled account', async () => {
    await prisma.user.update({ where: { id: ids.user }, data: { inactive: true } });

    const { sent } = await requestPasswordReset(EMAIL);

    expect(sent).toBe(false);
    expect(await queuedMail()).toHaveLength(0);
    expect(await prisma.singleUseToken.findMany({ where: { userId: ids.user } })).toHaveLength(0);
  });

  /**
   * Asking again does **not** withdraw the link somebody is already holding.
   *
   * The reverse used to be true, and it was the wrong way round. This endpoint needs no
   * authentication, so revoking on request let anyone who knew an address destroy that person's
   * working recovery link, repeatedly, without ever seeing their mailbox. Both links belong to
   * the same mailbox anyway, and the first one *used* still withdraws the rest.
   */
  it('leaves an earlier link working when a second is requested', async () => {
    await requestPasswordReset(EMAIL);
    const first = await tokenFromLastEmail();
    await requestPasswordReset(EMAIL);
    const second = await tokenFromLastEmail();

    expect(first).not.toBe(second);
    expect(await completePasswordReset(first, NEW_PASSWORD)).toMatchObject({ ok: true });
  });

  it('lets the newer link be used instead', async () => {
    await requestPasswordReset(EMAIL);
    await requestPasswordReset(EMAIL);

    expect(await completePasswordReset(await tokenFromLastEmail(), NEW_PASSWORD)).toMatchObject({
      ok: true,
    });
  });

  /** Using either one withdraws every other, which is the property that actually matters. */
  it('withdraws the remaining links once one has been used', async () => {
    await requestPasswordReset(EMAIL);
    const first = await tokenFromLastEmail();
    await requestPasswordReset(EMAIL);
    const second = await tokenFromLastEmail();

    expect(await completePasswordReset(second, NEW_PASSWORD)).toMatchObject({ ok: true });
    expect(await completePasswordReset(first, 'An0ther!Password')).toMatchObject({ ok: false });
  });

  it('never puts the token in the database in a usable form', async () => {
    await requestPasswordReset(EMAIL);
    const token = await tokenFromLastEmail();

    const rows = await prisma.singleUseToken.findMany({ where: { userId: ids.user } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashSingleUseToken(token));
    expect(rows[0]!.tokenHash).not.toBe(token);
  });
});

describe('completing a reset', () => {
  const requestToken = async () => {
    await requestPasswordReset(EMAIL);
    return tokenFromLastEmail();
  };

  it('sets the new password', async () => {
    const result = await completePasswordReset(await requestToken(), NEW_PASSWORD);

    expect(result).toMatchObject({ ok: true });
    expect(await bcrypt.compare(NEW_PASSWORD, await storedHash(ids.user))).toBe(true);
  });

  it('refuses a link that has already been used', async () => {
    const token = await requestToken();
    await completePasswordReset(token, NEW_PASSWORD);

    expect(await completePasswordReset(token, 'An0ther!Pass1')).toMatchObject({ ok: false });
  });

  /**
   * Two clicks on the same link at once. Without the conditional update underneath, both would
   * succeed and the second password would silently win.
   */
  it('lets only one of two simultaneous uses through', async () => {
    const token = await requestToken();

    const results = await Promise.all([
      completePasswordReset(token, NEW_PASSWORD),
      completePasswordReset(token, 'An0ther!Pass1'),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  /**
   * `passwordChangedAt` is what existing sessions and previously-issued client tokens compare
   * themselves against, so moving it is how a reset signs the account out everywhere. A reset
   * usually means the account was compromised, and a stolen client token that outlived it would
   * defeat the point entirely.
   */
  it('signs the account out everywhere by moving passwordChangedAt forward', async () => {
    const before = new Date(Date.now() - 60_000);
    await prisma.user.update({ where: { id: ids.user }, data: { passwordChangedAt: before } });

    await completePasswordReset(await requestToken(), NEW_PASSWORD);

    const user = await prisma.user.findUnique({ where: { id: ids.user } });
    expect(user!.passwordChangedAt!.getTime()).toBeGreaterThan(before.getTime());
  });

  // Recovering an account is also the way out of a lockout. Refusing here would leave someone
  // who has just proved control of their mailbox still shut out.
  it('clears a failed-login lockout', async () => {
    const token = await requestToken();
    await prisma.user.update({
      where: { id: ids.user },
      data: { lockedUntil: new Date(Date.now() + 600_000) },
    });

    await completePasswordReset(token, NEW_PASSWORD);

    const user = await prisma.user.findUnique({ where: { id: ids.user } });
    expect(user!.lockedUntil).toBeNull();
  });

  it('clears the temporary-password flag', async () => {
    const token = await requestToken();
    await prisma.user.update({ where: { id: ids.user }, data: { temporaryPassword: true } });

    await completePasswordReset(token, NEW_PASSWORD);

    const user = await prisma.user.findUnique({ where: { id: ids.user } });
    expect(user!.temporaryPassword).toBe(false);
  });

  // Disabled between asking for the link and following it. The link must not walk them back in.
  it('refuses a link for an account disabled in the meantime', async () => {
    const token = await requestToken();
    await prisma.user.update({ where: { id: ids.user }, data: { inactive: true } });

    expect(await completePasswordReset(token, NEW_PASSWORD)).toMatchObject({ ok: false });

    expect(await bcrypt.compare(NEW_PASSWORD, await storedHash(ids.user))).toBe(false);
  });

  /**
   * The whole thing is one transaction, so a refusal must leave nothing behind: no spent token
   * without a password change, and no password change without a spent token.
   */
  it('leaves the password untouched when the link is rejected', async () => {
    await completePasswordReset('never-issued', NEW_PASSWORD);

    expect(await bcrypt.compare('OldPassw0rd!', await storedHash(ids.user))).toBe(true);
  });
});
