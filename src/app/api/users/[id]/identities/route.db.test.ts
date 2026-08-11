import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';

/**
 * An administrator looking at how somebody signs in, against a real Postgres.
 *
 * Two things matter. Only administrators may see it, because it is somebody else's account.
 * And detaching their last way in is refused, exactly as the self-service page refuses it: an
 * account with no password and no identity can only be recovered by editing the database.
 */

const ISSUER = 'https://idp.example.test';
const ids = { admin: 'u-ident-admin', faculty: 'u-ident-faculty', target: 'u-ident-target' };

const session = vi.hoisted(() => ({
  current: null as { user: { id: string; isAdmin: boolean } } | null,
}));
vi.mock('@/lib/auth', () => ({ auth: async () => session.current }));

const { GET, DELETE } = await import('./route');

const ctx = { params: Promise.resolve({ id: ids.target }) };
const get = () => GET(new Request('https://afct.test/api/users/x/identities'), ctx);
const del = (identityId: string) =>
  DELETE(
    new Request(`https://afct.test/api/users/x/identities?identityId=${identityId}`, {
      method: 'DELETE',
    }),
    ctx,
  );

async function destroyFixtures() {
  await prisma.activityLog.deleteMany({ where: { userId: { in: Object.values(ids) } } });
  await prisma.linkedIdentity.deleteMany({ where: { issuer: ISSUER } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
}

beforeEach(async () => {
  await destroyFixtures();
  await prisma.user.createMany({
    data: [
      { id: ids.admin, email: 'identadmin@example.test', password: 'x', isAdmin: true },
      { id: ids.faculty, email: 'identfaculty@example.test', password: 'x' },
      // No password: their identity is the only way in.
      { id: ids.target, email: 'identtarget@example.test', password: null },
    ],
  });
  await prisma.linkedIdentity.create({
    data: {
      id: 'li-ident-1',
      userId: ids.target,
      kind: 'OIDC',
      issuer: ISSUER,
      subject: 'sub-1',
      linkedVia: 'AUTO_VERIFIED_EMAIL',
    },
  });
  session.current = { user: { id: ids.admin, isAdmin: true } };
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('what an administrator sees', () => {
  it('lists how the person signs in', async () => {
    const body = await (await get()).json();

    expect(body.identities).toHaveLength(1);
    expect(body.identities[0]).toMatchObject({ kind: 'OIDC', issuer: ISSUER });
    expect(body.hasPassword).toBe(false);
  });

  it('says whether a password exists, never anything about it', async () => {
    await prisma.user.update({ where: { id: ids.target }, data: { password: 'a-real-hash' } });

    const body = await (await get()).json();

    expect(body.hasPassword).toBe(true);
    expect(JSON.stringify(body)).not.toContain('a-real-hash');
  });
});

describe('who may look', () => {
  it('refuses a faculty member', async () => {
    session.current = { user: { id: ids.faculty, isAdmin: false } };

    expect((await get()).status).toBe(403);
  });

  it('refuses somebody signed out', async () => {
    session.current = null;

    expect((await get()).status).toBe(401);
  });
});

describe('detaching one', () => {
  /**
   * The same refusal as the self-service page. An administrator helping with a sign-in problem
   * must not be able to create a worse one.
   */
  it('refuses to remove the only way in', async () => {
    const res = await del('li-ident-1');

    expect(res.status).toBe(409);
    expect(await prisma.linkedIdentity.count({ where: { userId: ids.target } })).toBe(1);
  });

  it('allows it once they have a password', async () => {
    await prisma.user.update({ where: { id: ids.target }, data: { password: 'x' } });

    expect((await del('li-ident-1')).status).toBe(200);
    expect(await prisma.linkedIdentity.count({ where: { userId: ids.target } })).toBe(0);
  });

  /**
   * The administrator did this, not the account holder. Recording it the other way round would
   * make an admin action look like the person's own, which is the whole point of the log.
   */
  it('records the administrator as the actor and the person as the subject', async () => {
    await prisma.user.update({ where: { id: ids.target }, data: { password: 'x' } });

    await del('li-ident-1');

    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { action: 'IDENTITY_UNLINKED' },
    });
    expect(entry.userId).toBe(ids.admin);
    expect(entry.metadata).toMatchObject({ targetUserId: ids.target });
  });

  it('will not detach an identity belonging to somebody else', async () => {
    await prisma.user.update({ where: { id: ids.target }, data: { password: 'x' } });
    await prisma.linkedIdentity.create({
      data: {
        id: 'li-ident-other',
        userId: ids.faculty,
        kind: 'OIDC',
        issuer: ISSUER,
        subject: 'sub-other',
        linkedVia: 'AUTO_VERIFIED_EMAIL',
      },
    });

    const res = await del('li-ident-other');

    expect(res.status).toBe(404);
    expect(await prisma.linkedIdentity.count({ where: { userId: ids.faculty } })).toBe(1);
  });
});
