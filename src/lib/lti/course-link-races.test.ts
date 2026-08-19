import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

/**
 * The two paths a real database cannot be made to take on demand.
 *
 * Both functions catch exactly one failure: the unique constraint two simultaneous launches
 * collide on. Proving that needs `create` to throw P2002 at a chosen moment, which a Postgres
 * test can only produce by racing, and a race decides for itself which branch runs. The
 * database tests next door cover what they can prove (a row that already exists, a foreign key
 * that does not hold); these cover the branch behind the catch.
 */

const prismaMock = vi.hoisted(() => ({
  roster: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
  user: { findUnique: vi.fn() },
  ltiContextLink: { create: vi.fn() },
  course: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: vi.fn() }));

const { enrolFromLaunch, linkLaunchCourse } = await import('@/lib/lti/course-link');

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(`simulated ${code}`, {
    code,
    clientVersion: 'test',
  });

const LEARNER = ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enrolFromLaunch, when another launch got there first', () => {
  it('returns the role the database settled on, not the one this launch proposed', async () => {
    // Nothing when it looks; the competing insert lands; the constraint refuses this one.
    prismaMock.roster.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ role: 'TA' });
    prismaMock.roster.create.mockRejectedValueOnce(prismaError('P2002'));

    const result = await enrolFromLaunch({ courseId: 'c1', userId: 'u1', roles: LEARNER });

    // The launch said Learner. The row says TA, and the row is the answer: an LMS role must
    // not quietly demote somebody who is course staff in AFCT.
    expect(result).toEqual({ created: false, role: 'TA' });
    expect(prismaMock.roster.create).toHaveBeenCalledTimes(1);
  });

  it('refuses to claim an enrolment when the row it was told about is not there', async () => {
    prismaMock.roster.findUnique.mockResolvedValue(null);
    prismaMock.roster.create.mockRejectedValueOnce(prismaError('P2002'));

    // The constraint said the row exists. If it does not, something is wrong that answering
    // "enrolled as Learner" would hide, and the launch would open a course nobody joined.
    await expect(
      enrolFromLaunch({ courseId: 'c1', userId: 'u1', roles: LEARNER }),
    ).rejects.toThrow(/vanished/);
  });

  it('lets any other database failure travel unchanged', async () => {
    prismaMock.roster.findUnique.mockResolvedValue(null);
    prismaMock.roster.create.mockRejectedValueOnce(prismaError('P1001'));

    await expect(
      enrolFromLaunch({ courseId: 'c1', userId: 'u1', roles: LEARNER }),
    ).rejects.toMatchObject({ code: 'P1001' });
    // And it must not have gone looking for a row to report as success.
    expect(prismaMock.roster.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('linkLaunchCourse, when the link already exists', () => {
  const identity = {
    platformId: 'p1',
    contextId: 'ctx-1',
    contextTitle: null,
    issuer: 'https://lms.test',
  } as never;

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({ isAdmin: true });
  });

  it('reports it as already linked', async () => {
    prismaMock.ltiContextLink.create.mockRejectedValueOnce(prismaError('P2002'));

    const result = await linkLaunchCourse({
      identity,
      courseId: 'c1',
      userId: 'u1',
      context: {} as never,
    });

    expect(result).toEqual({ ok: false, reason: 'already-linked' });
  });

  /**
   * The one that mattered: an unreachable database told a professor their course was already
   * connected, and they went looking for a link that was never made.
   */
  it('does not report a database failure as already linked', async () => {
    prismaMock.ltiContextLink.create.mockRejectedValueOnce(prismaError('P1001'));

    await expect(
      linkLaunchCourse({ identity, courseId: 'c1', userId: 'u1', context: {} as never }),
    ).rejects.toMatchObject({ code: 'P1001' });
  });
});
