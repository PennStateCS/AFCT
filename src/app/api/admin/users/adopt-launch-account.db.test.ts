import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';

/**
 * Moving an LMS sign-in onto a newly created account, against a real Postgres.
 *
 * An instructor who opens the AFCT link before anybody has made them an account gets one made
 * on the spot, bound to their LMS subject. When their real account arrives later, every launch
 * still resolves to the first one, which staffs nothing. This is the repair, and it runs at the
 * one moment an administrator can see both halves.
 *
 * Two things are load-bearing and are asserted rather than assumed. The create and the move are
 * one transaction, so a refusal leaves no account behind. And the moved sign-in stops being a
 * just-in-time one, because promoting somebody to administrator deletes every automatic link
 * they have, which would otherwise silently sever the sign-in this exists to preserve.
 */

const ISSUER = 'https://canvas.adopt.test';
const ids = { admin: 'u-adopt-admin', orphan: 'u-adopt-orphan', course: 'c-adopt' };
const NEW_EMAIL = 'bruce.wayne@example.edu';

const session = vi.hoisted(() => ({
  current: null as { user: { id: string; isAdmin: boolean } } | null,
}));
vi.mock('@/lib/auth', () => ({ auth: async () => session.current }));

const { POST } = await import('./route');

const create = (body: Record<string, unknown>) =>
  POST(
    new Request('https://afct.test/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: NEW_EMAIL,
        firstName: 'Bruce',
        lastName: 'Wayne',
        password: 'Str0ng!Passw0rd',
        ...body,
      }),
    }),
    { params: Promise.resolve({}) } as never,
  );

async function destroyFixtures() {
  await prisma.activityLog.deleteMany({ where: { userId: ids.admin } });
  await prisma.roster.deleteMany({ where: { courseId: ids.course } });
  await prisma.linkedIdentity.deleteMany({ where: { issuer: ISSUER } });
  await prisma.course.deleteMany({ where: { id: ids.course } });
  await prisma.user.deleteMany({ where: { email: NEW_EMAIL } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.orphan] } } });
}

beforeEach(async () => {
  await destroyFixtures();
  await prisma.user.createMany({
    data: [
      { id: ids.admin, email: 'adopt-admin@example.test', password: 'x', isAdmin: true },
      { id: ids.orphan, email: 'bruce@lms.test', firstName: 'Bruce', lastName: 'Wayne' },
    ],
  });
  await prisma.linkedIdentity.create({
    data: {
      userId: ids.orphan,
      kind: 'LTI',
      linkedVia: 'JUST_IN_TIME',
      issuer: ISSUER,
      subject: 'lms-subject-1',
    },
  });
  session.current = { user: { id: ids.admin, isAdmin: true } };
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('creating an account that adopts an LMS sign-in', () => {
  it('moves the sign-in and retires the account it came from', async () => {
    const res = await create({ adoptLaunchAccountId: ids.orphan });
    expect(res.status).toBe(201);

    const created = await prisma.user.findUniqueOrThrow({ where: { email: NEW_EMAIL } });
    const identity = await prisma.linkedIdentity.findFirstOrThrow({ where: { issuer: ISSUER } });

    expect(identity.userId).toBe(created.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.orphan } })).inactive).toBe(
      true,
    );
  });

  /**
   * `JUST_IN_TIME` counts as an automatic link, and promoting somebody to administrator deletes
   * every automatic link they hold. Left as it was, adopting an instructor's sign-in and then
   * making them an admin would quietly take it away again.
   */
  it('records the moved sign-in as attached by an administrator', async () => {
    await create({ adoptLaunchAccountId: ids.orphan });

    const identity = await prisma.linkedIdentity.findFirstOrThrow({ where: { issuer: ISSUER } });

    expect(identity.linkedVia).toBe('ADMIN');
  });

  it('says who it moved, so the log is worth reading a year later', async () => {
    await create({ adoptLaunchAccountId: ids.orphan });

    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { action: 'USER_IDENTITY_REASSIGNED' },
    });

    expect(entry.severity).toBe('WARNING');
    expect(entry.userId).toBe(ids.admin);
    expect(entry.metadata).toMatchObject({
      fromUserId: ids.orphan,
      fromUserEmail: 'bruce@lms.test',
      targetUserEmail: NEW_EMAIL,
      issuer: ISSUER,
      orphanDeactivated: true,
    });
  });

  /**
   * The warning and the tick are separate requests with a person in between, so the account can
   * be used while they read. Acting on what used to be true would retire an account that now
   * holds somebody's work.
   */
  it('refuses when the account has been used since the warning was shown', async () => {
    await prisma.course.create({
      data: {
        id: ids.course,
        name: 'Theory',
        code: 'CMPSC 464',
        semester: 'Fall 2026',
        credits: 3,
        startDate: new Date('2026-08-24T00:00:00Z'),
        endDate: new Date('2026-12-18T00:00:00Z'),
      },
    });
    await prisma.roster.create({
      data: { courseId: ids.course, userId: ids.orphan, role: 'FACULTY' },
    });

    const res = await create({ adoptLaunchAccountId: ids.orphan });

    expect(res.status).toBe(409);
    // The whole point of one transaction: a refusal leaves nothing half-done behind.
    expect(await prisma.user.findUnique({ where: { email: NEW_EMAIL } })).toBeNull();
    const identity = await prisma.linkedIdentity.findFirstOrThrow({ where: { issuer: ISSUER } });
    expect(identity.userId).toBe(ids.orphan);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.orphan } })).inactive).toBe(
      false,
    );
  });

  it('creates the account and touches nothing when no adoption is asked for', async () => {
    const res = await create({});
    expect(res.status).toBe(201);

    const identity = await prisma.linkedIdentity.findFirstOrThrow({ where: { issuer: ISSUER } });
    expect(identity.userId).toBe(ids.orphan);
    expect(identity.linkedVia).toBe('JUST_IN_TIME');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.orphan } })).inactive).toBe(
      false,
    );
  });
});
