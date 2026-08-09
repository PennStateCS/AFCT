import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  consumeSingleUseToken,
  hashSingleUseToken,
  issueSingleUseToken,
  purgeExpiredSingleUseTokens,
  revokeSingleUseTokens,
} from './single-use-token';

/**
 * Single-use tokens, against a real Postgres.
 *
 * "Works exactly once" is the entire value of a password-reset link, and it is not something a
 * mocked test can prove. A mock returns whatever it was told to, so a check-then-act
 * implementation (read the row, see it unused, write it) passes there and loses the race here:
 * at READ COMMITTED two concurrent redemptions both read `usedAt` as null and both proceed.
 *
 * `consumeSingleUseToken` puts the condition in the `where` of a single update instead, so
 * Postgres serialises the two writes on the row and exactly one reports a match. These tests
 * exist to hold that line, because the mocked version of them cannot.
 */

const SUFFIX = 'sutint';
const ids = { user: `u-${SUFFIX}` };

async function destroyFixtures() {
  await prisma.singleUseToken.deleteMany({ where: { userId: ids.user } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
}

async function seedFixtures() {
  await prisma.user.create({
    data: {
      id: ids.user,
      email: `${SUFFIX}@example.test`,
      firstName: 'Token',
      lastName: 'Fixture',
      password: 'not-a-real-hash',
    },
  });
}

beforeEach(async () => {
  await destroyFixtures();
  await seedFixtures();
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

const issue = (ttlMs = 60_000) =>
  issueSingleUseToken({ purpose: 'PASSWORD_RESET', userId: ids.user, ttlMs });

describe('issuing', () => {
  it('never stores the plaintext token', async () => {
    const { token } = await issue();

    const row = await prisma.singleUseToken.findUnique({
      where: { tokenHash: hashSingleUseToken(token) },
    });
    expect(row).not.toBeNull();

    // The only way to find the row is by hash. Nothing in the table equals the token itself.
    const all = await prisma.singleUseToken.findMany({ where: { userId: ids.user } });
    expect(all.every((r) => r.tokenHash !== token)).toBe(true);
  });

  it('issues distinct tokens', async () => {
    const [a, b] = await Promise.all([issue(), issue()]);
    expect(a.token).not.toBe(b.token);
  });
});

describe('spending a token', () => {
  it('returns who it was issued for', async () => {
    const { token } = await issue();

    const result = await consumeSingleUseToken({ token, purpose: 'PASSWORD_RESET' });

    expect(result?.userId).toBe(ids.user);
  });

  /**
   * The race the database is here to settle. Two clicks on the same link, at once. A
   * check-then-act implementation lets both through, which means a reset link that works twice.
   */
  it('lets exactly one of two simultaneous redemptions succeed', async () => {
    const { token } = await issue();

    const results = await Promise.all([
      consumeSingleUseToken({ token, purpose: 'PASSWORD_RESET' }),
      consumeSingleUseToken({ token, purpose: 'PASSWORD_RESET' }),
    ]);

    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it('refuses a token that has already been spent', async () => {
    const { token } = await issue();
    await consumeSingleUseToken({ token, purpose: 'PASSWORD_RESET' });

    expect(await consumeSingleUseToken({ token, purpose: 'PASSWORD_RESET' })).toBeNull();
  });

  it('refuses an expired token', async () => {
    const { token } = await issue(-1_000); // already past its expiry

    expect(await consumeSingleUseToken({ token, purpose: 'PASSWORD_RESET' })).toBeNull();
  });

  it('refuses a token nobody issued', async () => {
    expect(
      await consumeSingleUseToken({ token: 'not-a-real-token', purpose: 'PASSWORD_RESET' }),
    ).toBeNull();
  });

  // An expired or already-spent token stays in the table, so the row exists but must not be
  // redeemable. Confirms the refusal is the condition doing its job, not an absent row.
  it('leaves a spent token in place, marked used', async () => {
    const { token } = await issue();
    await consumeSingleUseToken({ token, purpose: 'PASSWORD_RESET' });

    const row = await prisma.singleUseToken.findUnique({
      where: { tokenHash: hashSingleUseToken(token) },
    });
    expect(row?.usedAt).not.toBeNull();
  });
});

describe('revoking', () => {
  it('withdraws every outstanding token for a user', async () => {
    const a = await issue();
    const b = await issue();

    const revoked = await revokeSingleUseTokens({
      userId: ids.user,
      purpose: 'PASSWORD_RESET',
    });

    expect(revoked).toBe(2);
    expect(await consumeSingleUseToken({ token: a.token, purpose: 'PASSWORD_RESET' })).toBeNull();
    expect(await consumeSingleUseToken({ token: b.token, purpose: 'PASSWORD_RESET' })).toBeNull();
  });

  it('does not disturb a token that was already spent', async () => {
    const { token } = await issue();
    await consumeSingleUseToken({ token, purpose: 'PASSWORD_RESET' });

    expect(await revokeSingleUseTokens({ userId: ids.user, purpose: 'PASSWORD_RESET' })).toBe(0);
  });
});

describe('purging', () => {
  it('keeps recently expired tokens so a support question can be answered', async () => {
    await issue(-1_000);

    await purgeExpiredSingleUseTokens();

    expect(await prisma.singleUseToken.count({ where: { userId: ids.user } })).toBe(1);
  });

  it('deletes tokens well past their expiry', async () => {
    const { token } = await issue();
    await prisma.singleUseToken.update({
      where: { tokenHash: hashSingleUseToken(token) },
      data: { expiresAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    });

    await purgeExpiredSingleUseTokens();

    expect(await prisma.singleUseToken.count({ where: { userId: ids.user } })).toBe(0);
  });
});

/**
 * Deleting a user must take their outstanding links with them. A reset link that outlived its
 * account would be a way back into a deleted identity.
 */
describe('the cascade', () => {
  it('removes a user\'s tokens when the user is deleted', async () => {
    await issue();

    await prisma.user.delete({ where: { id: ids.user } });

    expect(await prisma.singleUseToken.count({ where: { userId: ids.user } })).toBe(0);
  });
});
