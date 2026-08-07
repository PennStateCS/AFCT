import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { deleteGroupIfSetUnlocked, lockGroupSetIfUsed } from './group-set-service';
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
