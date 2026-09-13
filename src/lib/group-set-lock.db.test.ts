import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  deleteGroupIfSetUnlocked,
  lockGroupSetIfUsed,
  withUnlockedGroupSet,
} from './group-set-service';
import { GroupSetLockedError } from './group-sets';

/**
 * The group-set lock, against a real Postgres.
 *
 * Once work has been submitted or graded against a set, its groups freeze. That rule is
 * what keeps a grade describing the group that actually earned it, so the interesting case
 * is not "is the set locked" but "what happens when it becomes locked at the same moment a
 * group is being deleted".
 *
 * The route's mocked test proves the code checks the lock. It cannot prove the check and
 * the delete are atomic, and they were not: reading `lockedAt` inside the transaction and
 * then deleting is still a check-then-act, because the delete runs at READ COMMITTED and a
 * lock committed after that read is invisible to it. The submission path being SERIALIZABLE
 * does not help either, since Postgres only applies those guarantees between serializable
 * transactions. `deleteGroupIfSetUnlocked` takes the set's row lock first instead, which is
 * the same row the locker updates.
 */

const SUFFIX = 'lockint';
const ids = {
  user: `u-${SUFFIX}`,
  course: `c-${SUFFIX}`,
  groupSet: `gs-${SUFFIX}`,
  group: `g-${SUFFIX}`,
};

async function destroyFixtures() {
  await prisma.groupMembership.deleteMany({ where: { courseId: ids.course } });
  await prisma.studentGroup.deleteMany({ where: { groupSetId: ids.groupSet } });
  await prisma.groupSet.deleteMany({ where: { id: ids.groupSet } });
  await prisma.roster.deleteMany({ where: { courseId: ids.course } });
  await prisma.course.deleteMany({ where: { id: ids.course } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
}

async function seedFixtures() {
  await prisma.user.create({
    data: {
      id: ids.user,
      email: `${SUFFIX}@example.test`,
      firstName: 'Lock',
      lastName: 'Fixture',
      password: 'not-a-real-hash',
    },
  });
  await prisma.course.create({
    data: {
      id: ids.course,
      name: 'Lock Fixture Course',
      code: `LINT ${Math.floor(Math.random() * 900 + 100)}`,
      semester: 'Summer 2026',
      credits: 3,
      timezone: 'America/New_York',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    },
  });
  await prisma.groupSet.create({
    data: { id: ids.groupSet, name: `Set ${SUFFIX}`, courseId: ids.course },
  });
  await prisma.studentGroup.create({
    data: { id: ids.group, name: `Group ${SUFFIX}`, groupSetId: ids.groupSet },
  });
}

const groupExists = async () =>
  (await prisma.studentGroup.findUnique({ where: { id: ids.group } })) !== null;

const setLockedAt = async () =>
  (await prisma.groupSet.findUnique({ where: { id: ids.groupSet }, select: { lockedAt: true } }))
    ?.lockedAt ?? null;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  await destroyFixtures();
  await seedFixtures();
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('deleting a group from an unlocked set', () => {
  it('removes the group', async () => {
    await deleteGroupIfSetUnlocked(ids.groupSet, ids.group);

    expect(await groupExists()).toBe(false);
  });

  it('leaves the set itself in place and still unlocked', async () => {
    await deleteGroupIfSetUnlocked(ids.groupSet, ids.group);

    expect(await setLockedAt()).toBeNull();
    expect(await prisma.groupSet.findUnique({ where: { id: ids.groupSet } })).not.toBeNull();
  });
});

describe('deleting a group from a locked set', () => {
  it('refuses, and leaves the group alone', async () => {
    await lockGroupSetIfUsed(prisma, ids.groupSet);

    await expect(deleteGroupIfSetUnlocked(ids.groupSet, ids.group)).rejects.toThrow(
      GroupSetLockedError,
    );
    expect(await groupExists()).toBe(true);
  });

  it('keeps refusing, because the lock is never cleared', async () => {
    await lockGroupSetIfUsed(prisma, ids.groupSet);
    const first = await setLockedAt();

    // A second call must not re-stamp or somehow clear it.
    await lockGroupSetIfUsed(prisma, ids.groupSet);

    expect(await setLockedAt()).toEqual(first);
    await expect(deleteGroupIfSetUnlocked(ids.groupSet, ids.group)).rejects.toThrow(
      GroupSetLockedError,
    );
  });
});

describe('a lock landing while the delete is in flight', () => {
  it('makes the delete wait for the locker, then refuse', async () => {
    // This is the case the mocked test cannot reach. A locker takes the set's row lock and
    // holds its transaction open; the delete must block on that same row rather than read a
    // stale `lockedAt` and go ahead.
    let releaseLocker!: () => void;
    const lockerMayCommit = new Promise<void>((resolve) => {
      releaseLocker = resolve;
    });

    const locker = prisma.$transaction(
      async (tx) => {
        await lockGroupSetIfUsed(tx, ids.groupSet);
        await lockerMayCommit;
      },
      { timeout: 20_000, maxWait: 20_000 },
    );

    // Let the locker take the row lock before the delete starts.
    await wait(250);

    const deleting = deleteGroupIfSetUnlocked(ids.groupSet, ids.group);
    let settled = false;
    void deleting.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await wait(400);
    // Still waiting on the locker's row lock: it has not been allowed to read past it.
    expect(settled).toBe(false);
    expect(await groupExists()).toBe(true);

    releaseLocker();
    await locker;

    await expect(deleting).rejects.toThrow(GroupSetLockedError);
    expect(await groupExists()).toBe(true);
  });

  it('lets the delete win when it gets there first, and the lock lands after', async () => {
    // The other order is equally consistent: nothing had been submitted when the group
    // went, so the lock simply arrives against a set that no longer has it.
    await deleteGroupIfSetUnlocked(ids.groupSet, ids.group);
    await lockGroupSetIfUsed(prisma, ids.groupSet);

    expect(await groupExists()).toBe(false);
    expect(await setLockedAt()).not.toBeNull();
  });

  it('never deletes a group out of a set that was already locked, under contention', async () => {
    // Run both at once repeatedly. Whichever wins, the forbidden outcome is the group
    // being gone while the lock predates its removal.
    for (let attempt = 0; attempt < 5; attempt++) {
      await destroyFixtures();
      await seedFixtures();

      const results = await Promise.allSettled([
        lockGroupSetIfUsed(prisma, ids.groupSet),
        deleteGroupIfSetUnlocked(ids.groupSet, ids.group),
      ]);

      const deleteOutcome = results[1];
      const gone = !(await groupExists());

      if (deleteOutcome.status === 'rejected') {
        expect(deleteOutcome.reason).toBeInstanceOf(GroupSetLockedError);
        expect(gone).toBe(false);
      } else {
        // The delete succeeded, so it held the row lock while the set was unlocked.
        expect(gone).toBe(true);
      }
    }
  });
});

/**
 * The same lock, generalised.
 *
 * Membership edits and group creation had the check-then-act the delete path already fixed:
 * both read `lockedAt`, then wrote in a separate transaction. `withUnlockedGroupSet` puts the
 * caller's work under the set's row lock, so what follows here is the delete's race test
 * pointed at the helper every one of those routes now goes through.
 */
describe('working under the group-set lock', () => {
  const memberships = async () =>
    prisma.groupMembership.count({ where: { groupSetId: ids.groupSet } });

  it('does the work when the set is unlocked', async () => {
    const created = await withUnlockedGroupSet(ids.groupSet, async (tx) =>
      tx.studentGroup.create({
        data: { name: `Another ${SUFFIX}`, groupSetId: ids.groupSet },
        select: { id: true },
      }),
    );

    expect(created.id).toBeTruthy();
  });

  it('refuses, and rolls the work back, when the set is already locked', async () => {
    await lockGroupSetIfUsed(prisma, ids.groupSet);

    await expect(
      withUnlockedGroupSet(ids.groupSet, async (tx) =>
        tx.studentGroup.create({
          data: { name: `Should not exist ${SUFFIX}`, groupSetId: ids.groupSet },
        }),
      ),
    ).rejects.toThrow(GroupSetLockedError);

    expect(
      await prisma.studentGroup.findFirst({ where: { name: `Should not exist ${SUFFIX}` } }),
    ).toBeNull();
  });

  it('waits for a lock landing mid-flight, then refuses', async () => {
    // The case a mocked test cannot reach, and the whole reason the helper exists: a first
    // submission stamps the set while a membership edit is already under way.
    let releaseLocker!: () => void;
    const lockerMayCommit = new Promise<void>((resolve) => {
      releaseLocker = resolve;
    });

    const locker = prisma.$transaction(
      async (tx) => {
        await lockGroupSetIfUsed(tx, ids.groupSet);
        await lockerMayCommit;
      },
      { timeout: 20_000, maxWait: 20_000 },
    );

    await wait(250);

    const editing = withUnlockedGroupSet(ids.groupSet, async (tx) =>
      tx.groupMembership.create({
        data: {
          groupSetId: ids.groupSet,
          groupId: ids.group,
          courseId: ids.course,
          userId: ids.user,
        },
      }),
    );
    let settled = false;
    void editing.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await wait(400);
    // Blocked on the locker's row, not reading a stale `lockedAt` and carrying on.
    expect(settled).toBe(false);
    expect(await memberships()).toBe(0);

    releaseLocker();
    await locker;

    await expect(editing).rejects.toThrow(GroupSetLockedError);
    expect(await memberships()).toBe(0);
  });
});

/**
 * A group grade and a membership move, at the same moment.
 *
 * Group grading read its member list before the transaction and stamped the set locked at the
 * end of it, which left the whole window open: an instructor could move somebody out and
 * somebody else in, and the grade went to the people who used to be in the group, with the set
 * then frozen that way for good.
 *
 * Both take the set's row now, first, so one of them waits. Either outcome is consistent; what
 * must never happen is a grade written to a membership snapshot that has already moved.
 */
describe('grading a group while its membership is being changed', () => {
  const OTHER_USER = `u2-${SUFFIX}`;

  beforeEach(async () => {
    await prisma.user.create({
      data: { id: OTHER_USER, email: `${OTHER_USER}@example.test`, password: null },
    });
    // A membership points at a roster row, not a bare user: both have to be on the course.
    await prisma.roster.createMany({
      data: [ids.user, OTHER_USER].map((userId) => ({
        courseId: ids.course,
        userId,
        role: 'STUDENT' as const,
      })),
    });
    await prisma.groupMembership.create({
      data: {
        groupSetId: ids.groupSet,
        groupId: ids.group,
        courseId: ids.course,
        userId: ids.user,
      },
    });
  });

  afterEach(async () => {
    await prisma.groupMembership.deleteMany({ where: { courseId: ids.course } });
    await prisma.roster.deleteMany({ where: { courseId: ids.course } });
    await prisma.user.deleteMany({ where: { id: OTHER_USER } });
  });

  const membersOfGroup = async () =>
    (
      await prisma.groupMembership.findMany({
        where: { groupId: ids.group },
        select: { userId: true },
        orderBy: { userId: 'asc' },
      })
    ).map((m) => m.userId);

  /** The grading route's shape: lock the set, then read the membership it will write to. */
  function gradeTheGroup(opts: { pauseMs: number }) {
    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "GroupSet" WHERE "id" = ${ids.groupSet} FOR UPDATE`;
        await wait(opts.pauseMs);

        const group = await tx.studentGroup.findFirstOrThrow({
          where: { id: ids.group },
          select: { memberships: { select: { userId: true } } },
        });
        const memberIds = group.memberships.map((m) => m.userId);

        await lockGroupSetIfUsed(tx, ids.groupSet);
        return memberIds;
      },
      { timeout: 20_000 },
    );
  }

  it('grades the membership as it is when the grade lands, not as it was read earlier', async () => {
    // The move gets the set's row first. Grading waits on it, then reads the membership that
    // actually exists rather than the one the request set out with.
    const moving = withUnlockedGroupSet(ids.groupSet, async (tx) => {
      await tx.groupMembership.deleteMany({ where: { groupId: ids.group, userId: ids.user } });
      await tx.groupMembership.create({
        data: {
          groupSetId: ids.groupSet,
          groupId: ids.group,
          courseId: ids.course,
          userId: OTHER_USER,
        },
      });
      await wait(300);
    });
    await wait(100);
    const grading = gradeTheGroup({ pauseMs: 0 });

    const [, gradedMembers] = await Promise.all([moving, grading]);

    expect(gradedMembers).toEqual([OTHER_USER]);
    expect(await membersOfGroup()).toEqual([OTHER_USER]);
  });

  it('refuses the membership move when the grade gets there first', async () => {
    // The other order. Grading takes the row, stamps the set locked, and the move then finds a
    // locked set and is refused: the membership a grade was based on stops moving.
    const grading = gradeTheGroup({ pauseMs: 300 });
    await wait(100);
    const moving = withUnlockedGroupSet(ids.groupSet, async (tx) => {
      await tx.groupMembership.deleteMany({ where: { groupId: ids.group, userId: ids.user } });
    });

    const [gradingResult, movingResult] = await Promise.allSettled([grading, moving]);

    expect(gradingResult.status).toBe('fulfilled');
    expect(movingResult.status).toBe('rejected');
    expect((movingResult as PromiseRejectedResult).reason).toBeInstanceOf(GroupSetLockedError);
    // The people the grade went to are still the people in the group.
    expect(await membersOfGroup()).toEqual([ids.user]);
  });
});
