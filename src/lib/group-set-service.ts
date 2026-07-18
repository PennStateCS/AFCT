import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { computeMembershipBasis, GroupSetLockedError } from '@/lib/group-sets';

/**
 * Stamp a group set's sticky lock the first time a submission or grade is created for an
 * assignment using it. Idempotent (only the first call sets lockedAt) and never cleared,
 * so removing the submission/grade later does not unlock. Call it inside the same
 * transaction as the submission/grade write so the lock and the record commit together.
 * No-op when the assignment is not a group assignment (groupSetId null).
 */
export async function lockGroupSetIfUsed(
  client: Prisma.TransactionClient,
  groupSetId: string | null | undefined,
): Promise<void> {
  if (!groupSetId) return;
  await client.groupSet.updateMany({
    where: { id: groupSetId, lockedAt: null },
    data: { lockedAt: new Date() },
  });
}

/**
 * A group set is locked against group/membership edits once its sticky lockedAt is set
 * (stamped by lockGroupSetIfUsed on the first submission or grade for a using-assignment).
 * The lock is never cleared, so it survives deleting the submission/grade. Renaming and
 * duplication stay allowed.
 */
export async function isGroupSetLocked(setId: string): Promise<boolean> {
  const set = await prisma.groupSet.findUnique({
    where: { id: setId },
    select: { lockedAt: true },
  });
  return set?.lockedAt != null;
}

/** Throws GroupSetLockedError when the set is locked. */
export async function assertGroupSetUnlocked(setId: string): Promise<void> {
  if (await isGroupSetLocked(setId)) throw new GroupSetLockedError();
}

/**
 * Reasons a group set cannot be deleted: it is locked (has submissions or grades), or an
 * assignment references it. Empty means deletion is allowed.
 */
export async function groupSetDeletionBlockers(setId: string): Promise<string[]> {
  const [set, assignmentCount] = await Promise.all([
    prisma.groupSet.findUnique({ where: { id: setId }, select: { lockedAt: true } }),
    prisma.assignment.count({ where: { groupSetId: setId } }),
  ]);
  const blockers: string[] = [];
  if (set?.lockedAt) {
    blockers.push('This group set has submissions or grades and cannot be deleted.');
  }
  if (assignmentCount > 0) {
    blockers.push(
      `This group set is used by ${assignmentCount} assignment${assignmentCount === 1 ? '' : 's'}.`,
    );
  }
  return blockers;
}

/** The subset of the given set ids that are locked (lockedAt set). */
async function lockedSetIds(setIds: string[]): Promise<Set<string>> {
  if (setIds.length === 0) return new Set();
  const locked = await prisma.groupSet.findMany({
    where: { id: { in: setIds }, lockedAt: { not: null } },
    select: { id: true },
  });
  return new Set(locked.map((s) => s.id));
}

/**
 * Server-side data access + DTO shaping for course group sets. Pairs with the
 * DB-free helpers in group-sets.ts. Never serializes anything about students who
 * are not part of the course.
 */

export type EligibleStudent = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
};

export type GroupMemberDTO = EligibleStudent & { inactive: boolean };

export type GroupDTO = {
  id: string;
  name: string;
  members: GroupMemberDTO[];
};

export type GroupSetSummaryDTO = {
  id: string;
  name: string;
  locked: boolean;
  groupCount: number;
  assignedCount: number;
};

export type GroupSetDetailDTO = {
  id: string;
  name: string;
  locked: boolean;
  groups: GroupDTO[];
  /** Active STUDENT roster members eligible to be assigned. */
  eligibleStudents: EligibleStudent[];
  /** Optimistic-concurrency token over the current memberships. */
  basis: string;
};

/** The Prisma where-clause for "active STUDENT roster member of this course". */
export const activeStudentRosterWhere = (courseId: string) => ({
  courseId,
  role: 'STUDENT' as const,
  user: { inactive: false },
});

/** Find a group set scoped to its course (null if it belongs to another course). */
export function findGroupSet(courseId: string, setId: string) {
  return prisma.groupSet.findFirst({ where: { id: setId, courseId } });
}

/** Active STUDENT roster members, ordered by name, eligible for assignment. */
export async function fetchEligibleStudents(courseId: string): Promise<EligibleStudent[]> {
  const roster = await prisma.roster.findMany({
    where: activeStudentRosterWhere(courseId),
    select: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
    orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
  });
  return roster.map((r) => r.user);
}

/** userIds among the given list that are active STUDENT roster members. */
export async function activeStudentIds(courseId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await prisma.roster.findMany({
    where: { ...activeStudentRosterWhere(courseId), userId: { in: userIds } },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

/** Group-set summaries for the selector (counts only, no member payloads). */
export async function loadGroupSetSummaries(courseId: string): Promise<GroupSetSummaryDTO[]> {
  const sets = await prisma.groupSet.findMany({
    where: { courseId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      _count: { select: { groups: true } },
      groups: { select: { _count: { select: { memberships: true } } } },
    },
  });
  const locked = await lockedSetIds(sets.map((s) => s.id));
  return sets.map((s) => ({
    id: s.id,
    name: s.name,
    locked: locked.has(s.id),
    groupCount: s._count.groups,
    assignedCount: s.groups.reduce((sum, g) => sum + g._count.memberships, 0),
  }));
}

/** Full detail for one set: groups, members (with inactive flag), eligible list. */
export async function loadGroupSetDetail(
  courseId: string,
  setId: string,
): Promise<GroupSetDetailDTO | null> {
  const set = await prisma.groupSet.findFirst({
    where: { id: setId, courseId },
    include: {
      groups: {
        orderBy: { createdAt: 'asc' },
        include: {
          memberships: {
            include: {
              roster: {
                select: {
                  userId: true,
                  user: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      email: true,
                      inactive: true,
                    },
                  },
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });
  if (!set) return null;

  const basisPairs: { userId: string; groupId: string }[] = [];
  const groups: GroupDTO[] = set.groups.map((g) => {
    const members: GroupMemberDTO[] = g.memberships.map((m) => {
      basisPairs.push({ userId: m.userId, groupId: g.id });
      const u = m.roster.user;
      return {
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        inactive: u.inactive,
      };
    });
    // Sort members by name for a stable display.
    members.sort((a, b) =>
      `${a.lastName ?? ''} ${a.firstName ?? ''}`.localeCompare(`${b.lastName ?? ''} ${b.firstName ?? ''}`),
    );
    return { id: g.id, name: g.name, members };
  });

  return {
    id: set.id,
    name: set.name,
    locked: await isGroupSetLocked(setId),
    groups,
    eligibleStudents: await fetchEligibleStudents(courseId),
    basis: computeMembershipBasis(basisPairs),
  };
}
