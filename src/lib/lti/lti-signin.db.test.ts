import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { resolveLaunchSignIn } from './lti-signin';
import type { LaunchIdentity } from './launch';

/**
 * Deciding whose account a launch belongs to, against a real Postgres.
 *
 * The rules are shared with institutional sign-in and proved there too. What is worth proving
 * *here* is what differs: a launch trusts the address it carries, and an administrator account
 * is still never attached automatically despite that trust.
 *
 * The case that ties it together is somebody who already signed in through SSO and then launches
 * from Canvas. They must land on the one account, not a second one, or their submissions and
 * their grades end up in different places.
 */

const SUFFIX = 'ltisignin';
const ISSUER = 'https://canvas.example.test';
const CONTEXT = { ipAddress: '10.0.0.1', userAgent: 'test' };

const ids = { user: `u-${SUFFIX}`, admin: `ua-${SUFFIX}` };
const EMAIL = `${SUFFIX}@example.test`;
const ADMIN_EMAIL = `${SUFFIX}-admin@example.test`;

const identity = (over: Partial<LaunchIdentity> = {}): LaunchIdentity => ({
  platformId: 'ltip-1',
  issuer: ISSUER,
  subject: 'lms-user-1',
  email: EMAIL,
  firstName: 'Ada',
  lastName: 'Lovelace',
  roles: [],
  contextId: null,
  contextTitle: null,
  resourceLinkId: null,
  targetLinkUri: null,
  lineItemsUrl: null,
  lineItemUrl: null,
  membershipsUrl: null,
  deepLink: null,
  assignmentId: null,
  ...over,
});

const resolve = (over: Partial<LaunchIdentity> = {}) =>
  resolveLaunchSignIn({ identity: identity(over), context: CONTEXT });

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

/**
 * The difference from OIDC. A launch can only come from a platform an administrator registered,
 * signed by that platform's key, and the LMS is the institution's own record of who its people
 * are. There is no equivalent of a provider where somebody sets their own address.
 */
describe('an address from a launch', () => {
  it('is trusted, with no verified-email claim needed', async () => {
    const result = await resolve();

    expect(result).toMatchObject({ ok: true, userId: ids.user, created: false });
  });

  it('creates an account for somebody nobody has seen', async () => {
    const result = await resolve({ email: `${SUFFIX}-new@example.test`, subject: 'lms-user-2' });

    expect(result).toMatchObject({ ok: true, created: true });
    const user = await prisma.user.findUnique({
      where: { email: `${SUFFIX}-new@example.test` },
    });
    expect(user?.password).toBeNull();
    expect(user?.firstName).toBe('Ada');
  });
});

describe('what trust does not relax', () => {
  /**
   * An AFCT admin can change any grade in the system, so attaching one deserves a deliberate
   * act however trustworthy the LMS is. They connect from their own account page instead.
   */
  it('still refuses to attach an administrator account automatically', async () => {
    const result = await resolve({ email: ADMIN_EMAIL, subject: 'lms-admin' });

    // The account comes back with the refusal, and only for this one reason: the launch
    // route uses it to offer a password confirmation instead of a dead end.
    expect(result).toMatchObject({ ok: false, reason: 'admin-requires-deliberate-link' });
    expect(result.ok === false && result.userId).toBeTruthy();
    expect(await prisma.linkedIdentity.count({ where: { userId: ids.admin } })).toBe(0);
  });

  it('refuses a deactivated account rather than reviving it', async () => {
    await prisma.user.update({ where: { id: ids.user }, data: { inactive: true } });

    expect(await resolve()).toEqual({ ok: false, reason: 'account-inactive' });
  });

  it('refuses a launch carrying no address', async () => {
    expect(await resolve({ email: '' })).toEqual({ ok: false, reason: 'no-email' });
  });
});

describe('someone who arrives more than one way', () => {
  it('is the same person on the second launch, even after their address changes', async () => {
    await resolve();

    const moved = await resolve({ email: `${SUFFIX}-renamed@example.test` });

    expect(moved).toMatchObject({ ok: true, userId: ids.user, created: false });
  });

  /**
   * The case that matters most in practice. Somebody signs in through SSO, then later opens
   * AFCT from Canvas. Two identities, one account: otherwise their submissions and their grades
   * live on separate accounts and neither is complete.
   */
  it('lands on the same account as their institutional sign-in', async () => {
    await prisma.linkedIdentity.create({
      data: {
        userId: ids.user,
        kind: 'OIDC',
        issuer: 'https://idp.example.test',
        subject: 'sso-user-1',
        linkedVia: 'AUTO_VERIFIED_EMAIL',
      },
    });

    const result = await resolve();

    expect(result).toMatchObject({ ok: true, userId: ids.user, created: false });
    expect(await prisma.linkedIdentity.count({ where: { userId: ids.user } })).toBe(2);
  });

  // Keyed on the platform's issuer rather than the AFCT registration, so a second deployment of
  // the same LMS is the same person rather than a new one.
  it('is one person across two deployments of the same LMS', async () => {
    await resolve({ platformId: 'ltip-1' });

    const second = await resolve({ platformId: 'ltip-2' });

    expect(second).toMatchObject({ ok: true, userId: ids.user });
    expect(await prisma.linkedIdentity.count({ where: { userId: ids.user } })).toBe(1);
  });
});
