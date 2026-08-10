import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';

/**
 * Listing and disconnecting your own institutional sign-ins, against a real Postgres.
 *
 * The guard worth proving is the refusal to remove the last way into an account: somebody with
 * no password and one identity would lock themselves out with their own click, and getting back
 * in needs an administrator.
 */

const SUFFIX = 'identroute';
const ISSUER = 'https://idp.example.test';

const ids = { withPassword: `up-${SUFFIX}`, noPassword: `un-${SUFFIX}`, other: `uo-${SUFFIX}` };

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));
vi.mock('@/lib/auth', () => ({ auth: async () => session.current }));

const { GET } = await import('./route');
const { DELETE } = await import('./[id]/route');

const del = (id: string) =>
  DELETE(new Request('http://localhost/api/me/identities/x', { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  });

async function destroyFixtures() {
  const userIds = Object.values(ids);
  await prisma.activityLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.linkedIdentity.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

beforeEach(async () => {
  await destroyFixtures();
  await prisma.user.createMany({
    data: [
      { id: ids.withPassword, email: `${SUFFIX}-p@example.test`, password: 'not-a-real-hash' },
      // The account an institutional sign-in creates: no password at all.
      { id: ids.noPassword, email: `${SUFFIX}-n@example.test`, password: null },
      { id: ids.other, email: `${SUFFIX}-o@example.test`, password: 'not-a-real-hash' },
    ],
  });
  await prisma.linkedIdentity.createMany({
    data: [
      { id: `li-p-${SUFFIX}`, userId: ids.withPassword, kind: 'OIDC', issuer: ISSUER, subject: 'p', linkedVia: 'SELF_SERVICE' },
      { id: `li-n-${SUFFIX}`, userId: ids.noPassword, kind: 'OIDC', issuer: ISSUER, subject: 'n', linkedVia: 'JUST_IN_TIME' },
      { id: `li-o-${SUFFIX}`, userId: ids.other, kind: 'OIDC', issuer: ISSUER, subject: 'o', linkedVia: 'SELF_SERVICE' },
    ],
  });
  session.current = { user: { id: ids.withPassword } };
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('listing your own identities', () => {
  it('returns yours and nobody else’s', async () => {
    const body = await (await GET()).json();

    expect(body.identities).toHaveLength(1);
    expect(body.identities[0].subject).toBe('p');
  });

  it('says whether a password exists, never anything about it', async () => {
    const body = await (await GET()).json();

    expect(body.hasPassword).toBe(true);
    expect(JSON.stringify(body)).not.toContain('not-a-real-hash');
  });

  it('refuses when not signed in', async () => {
    session.current = null;

    expect((await GET()).status).toBe(401);
  });
});

describe('disconnecting one', () => {
  it('removes it', async () => {
    expect((await del(`li-p-${SUFFIX}`)).status).toBe(200);
    expect(await prisma.linkedIdentity.count({ where: { userId: ids.withPassword } })).toBe(0);
  });

  it('records who did it', async () => {
    await del(`li-p-${SUFFIX}`);

    const entry = await prisma.activityLog.findFirst({
      where: { userId: ids.withPassword, action: 'IDENTITY_UNLINKED' },
    });
    expect(entry).not.toBeNull();
  });

  /**
   * The guard. Without it this click locks the person out of their own account, and no screen
   * in AFCT can get them back in.
   */
  it('refuses to remove the only way in', async () => {
    session.current = { user: { id: ids.noPassword } };

    const res = await del(`li-n-${SUFFIX}`);

    expect(res.status).toBe(409);
    expect(await prisma.linkedIdentity.count({ where: { userId: ids.noPassword } })).toBe(1);
  });

  it('allows it once a second identity exists', async () => {
    session.current = { user: { id: ids.noPassword } };
    await prisma.linkedIdentity.create({
      data: {
        userId: ids.noPassword,
        kind: 'OIDC',
        issuer: ISSUER,
        subject: 'n2',
        linkedVia: 'SELF_SERVICE',
      },
    });

    expect((await del(`li-n-${SUFFIX}`)).status).toBe(200);
  });

  // Scoped to the owner, so a guessed id removes nothing rather than removing theirs.
  it('will not remove somebody else’s', async () => {
    const res = await del(`li-o-${SUFFIX}`);

    expect(res.status).toBe(404);
    expect(await prisma.linkedIdentity.count({ where: { userId: ids.other } })).toBe(1);
  });

  it('refuses when not signed in', async () => {
    session.current = null;

    expect((await del(`li-p-${SUFFIX}`)).status).toBe(401);
  });
});
