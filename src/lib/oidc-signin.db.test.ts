import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { resolveOidcSignIn } from './oidc-signin';

/**
 * Deciding whose account an institutional sign-in belongs to, against a real Postgres.
 *
 * These are the rules that decide who gets into whose account, so they are worth proving
 * against real rows and real constraints rather than a mock that agrees with whatever it is
 * told. The refusals matter more than the successes: each one is somebody being kept out of an
 * account that is not theirs.
 */

const SUFFIX = 'oidcint';
const ISSUER = 'https://idp.example.test';
const CONTEXT = { ipAddress: '10.0.0.1', userAgent: 'test' };

const ids = { user: `u-${SUFFIX}`, admin: `ua-${SUFFIX}` };
const EMAIL = `${SUFFIX}@example.test`;
const ADMIN_EMAIL = `${SUFFIX}-admin@example.test`;

const claims = (over: Record<string, unknown> = {}) => ({
  issuer: ISSUER,
  subject: 'sub-1',
  email: EMAIL,
  emailVerified: true,
  ...over,
});

const resolve = (over: Record<string, unknown> = {}, trustEmail = false) =>
  resolveOidcSignIn({ claims: claims(over), trustEmail, context: CONTEXT });

async function destroyFixtures() {
  const users = await prisma.user.findMany({
    where: { email: { contains: SUFFIX } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.activityLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.linkedIdentity.deleteMany({ where: { issuer: ISSUER } });
  await prisma.user.deleteMany({ where: { email: { contains: SUFFIX } } });
}

beforeEach(async () => {
  await destroyFixtures();
  await prisma.user.createMany({
    data: [
      { id: ids.user, email: EMAIL, password: 'not-a-real-hash' },
      { id: ids.admin, email: ADMIN_EMAIL, password: 'not-a-real-hash', isAdmin: true },
    ],
  });
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('an identity that has signed in before', () => {
  it('goes to the account it is attached to', async () => {
    await resolve();

    const again = await resolve();
    expect(again).toMatchObject({ ok: true, userId: ids.user, created: false });
  });

  /**
   * The reason the link is keyed on subject rather than email: somebody whose address changed
   * is still themselves, and must not be treated as a new person.
   */
  it('still goes there after the provider changes their address', async () => {
    await resolve();

    const moved = await resolve({ email: `${SUFFIX}-new@example.test` });

    expect(moved).toMatchObject({ ok: true, userId: ids.user, created: false });
  });

  it('records that the identity was used', async () => {
    await resolve();
    await resolve();

    const [link] = await prisma.linkedIdentity.findMany({ where: { issuer: ISSUER } });
    expect(link?.lastSignInAt).not.toBeNull();
  });

  it('is refused once the account is switched off', async () => {
    await resolve();
    await prisma.user.update({ where: { id: ids.user }, data: { inactive: true } });

    expect(await resolve()).toEqual({ ok: false, reason: 'account-inactive' });
  });
});

describe('matching an existing account by email', () => {
  it('attaches the identity so the next sign-in needs no email at all', async () => {
    const first = await resolve();

    expect(first).toMatchObject({ ok: true, userId: ids.user });
    expect(await prisma.linkedIdentity.count({ where: { userId: ids.user } })).toBe(1);
  });

  it('refuses when the provider has not verified the address', async () => {
    expect(await resolve({ emailVerified: false })).toEqual({
      ok: false,
      reason: 'email-not-verified',
    });
    expect(await prisma.linkedIdentity.count()).toBe(0);
  });

  // The escape hatch for providers that never send the claim. It has to actually work, or
  // nobody at a Microsoft institution can sign in.
  it('accepts an unverified address when the provider is trusted', async () => {
    const result = await resolve({ emailVerified: false }, true);

    expect(result).toMatchObject({ ok: true, userId: ids.user });
  });

  /**
   * The guardrail that matters most. A provider where people can set their own address would
   * otherwise be a path straight into an administrator account.
   */
  it('never attaches automatically to an administrator', async () => {
    const result = await resolve({ email: ADMIN_EMAIL, subject: 'sub-admin' });

    expect(result).toEqual({ ok: false, reason: 'admin-requires-deliberate-link' });
    expect(await prisma.linkedIdentity.count({ where: { userId: ids.admin } })).toBe(0);
  });

  it('refuses a disabled account rather than reviving it', async () => {
    await prisma.user.update({ where: { id: ids.user }, data: { inactive: true } });

    expect(await resolve()).toEqual({ ok: false, reason: 'account-inactive' });
  });
});

describe('a person nobody has seen before', () => {
  const NEW_EMAIL = `${SUFFIX}-new-person@example.test`;

  it('gets an account, with no password on it', async () => {
    const result = await resolve({ email: NEW_EMAIL, firstName: 'Ada', lastName: 'Lovelace' });

    expect(result).toMatchObject({ ok: true, created: true });
    const user = await prisma.user.findUnique({ where: { email: NEW_EMAIL } });
    expect(user?.password).toBeNull();
    expect(user?.firstName).toBe('Ada');
  });

  it('gets the identity attached at the same time', async () => {
    await resolve({ email: NEW_EMAIL });

    const user = await prisma.user.findUnique({ where: { email: NEW_EMAIL } });
    expect(await prisma.linkedIdentity.count({ where: { userId: user!.id } })).toBe(1);
  });

  /**
   * Creating on an unverified address is the same takeover as matching on one, a step later:
   * squat the address before its owner arrives, and their verified sign-in later lands on the
   * account you already hold.
   */
  it('is not created from an address the provider has not verified', async () => {
    const result = await resolve({ email: NEW_EMAIL, emailVerified: false });

    expect(result).toEqual({ ok: false, reason: 'email-not-verified' });
    expect(await prisma.user.findUnique({ where: { email: NEW_EMAIL } })).toBeNull();
  });

  it('is refused when the provider sends no address', async () => {
    expect(await resolve({ email: null })).toEqual({ ok: false, reason: 'no-email' });
  });

  it('is recorded in the activity log as an account created by signing in', async () => {
    await resolve({ email: NEW_EMAIL });

    const [entry] = await prisma.activityLog.findMany({
      where: { action: 'IDENTITY_LINKED' },
      orderBy: { timestamp: 'desc' },
    });
    expect(entry?.metadata).toMatchObject({ via: 'JUST_IN_TIME', accountCreated: true });
  });
});
