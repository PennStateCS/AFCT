import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';

// The mailer is the one thing here that talks to the outside world. Everything else runs
// against the real database, because the properties worth proving are database properties.
const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/mailer', () => ({ sendMail: sendMailMock, isMailConfigured: async () => true }));

import { completePasswordReset, requestPasswordReset } from './password-reset';
import { hashSingleUseToken } from './single-use-token';

/**
 * Password reset, against a real Postgres.
 *
 * The rules here are mostly about what must *not* happen after a link is used: it must not work
 * twice, a second outstanding link must stop working, and the account's existing sessions and
 * client tokens must stop being honoured. Those are transactional and concurrent properties, so
 * a mock would only prove the mock.
 */

const SUFFIX = 'pwrint';
const ids = { user: `u-${SUFFIX}`, other: `u2-${SUFFIX}` };
const EMAIL = `${SUFFIX}@example.test`;
const NEW_PASSWORD = 'Str0ng!NewPass1';

async function destroyFixtures() {
  await prisma.singleUseToken.deleteMany({ where: { userId: { in: [ids.user, ids.other] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.user, ids.other] } } });
}

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

/** The token out of the most recent email, which is the only place it ever exists. */
const tokenFromLastEmail = (): string => {
  const body = sendMailMock.mock.calls.at(-1)?.[0]?.text as string;
  return new URL(body.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
};

beforeEach(async () => {
  vi.clearAllMocks();
  sendMailMock.mockResolvedValue(undefined);
  process.env.NEXTAUTH_URL = 'https://afct.test';
  await destroyFixtures();
  await seedFixtures();
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('requesting a link', () => {
  it('emails a link to a real account', async () => {
    const { sent } = await requestPasswordReset(EMAIL);

    expect(sent).toBe(true);
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ to: EMAIL }));
  });

  it('sends nothing for an address with no account', async () => {
    const { sent } = await requestPasswordReset('nobody@example.test');

    expect(sent).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  // An administrator turned the account off. A reset link would be a way back in.
  it('sends nothing for a disabled account', async () => {
    await prisma.user.update({ where: { id: ids.user }, data: { inactive: true } });

    const { sent } = await requestPasswordReset(EMAIL);

    expect(sent).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  // A forwarded or intercepted older email must stop working the moment a new one is asked for.
  it('withdraws an earlier link when a new one is requested', async () => {
    await requestPasswordReset(EMAIL);
    const first = tokenFromLastEmail();
    await requestPasswordReset(EMAIL);

    expect(await completePasswordReset(first, NEW_PASSWORD)).toMatchObject({ ok: false });
    expect(await completePasswordReset(tokenFromLastEmail(), NEW_PASSWORD)).toMatchObject({
      ok: true,
    });
  });

  it('never puts the token in the database in a usable form', async () => {
    await requestPasswordReset(EMAIL);
    const token = tokenFromLastEmail();

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
