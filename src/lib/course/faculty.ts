// src/lib/course/faculty.ts
//
// Pure roster-diff logic for reconciling a course's FACULTY set to a desired list.
// Kept free of Prisma so it can be unit-tested directly; the caller runs the resulting
// add/promote/remove operations inside its own transaction.

export type RosterMember = { userId: string; role: string };

export type FacultyRosterDiff = {
  /** Not on the roster at all — insert as FACULTY. */
  toAdd: string[];
  /** On the roster in another role — promote to FACULTY. */
  toPromote: string[];
  /** Currently FACULTY but no longer desired — remove. */
  toRemove: string[];
};

/**
 * Compute the roster changes needed to make the course's FACULTY set exactly
 * `instructorIds`: members not present are added, members in another role are promoted,
 * and existing faculty absent from the desired list are removed.
 */
export function diffFacultyRoster(
  existingRoster: RosterMember[],
  instructorIds: string[],
): FacultyRosterDiff {
  const existingFacultyIds = new Set(
    existingRoster.filter((r) => r.role === 'FACULTY').map((r) => r.userId),
  );
  const desiredFacultyIds = new Set(instructorIds);

  const toAdd: string[] = [];
  const toPromote: string[] = [];
  instructorIds.forEach((userId) => {
    const existing = existingRoster.find((r) => r.userId === userId);
    if (!existing) {
      toAdd.push(userId);
      return;
    }
    if (existing.role !== 'FACULTY') {
      toPromote.push(userId);
    }
  });
  const toRemove = Array.from(existingFacultyIds).filter((userId) => !desiredFacultyIds.has(userId));

  return { toAdd, toPromote, toRemove };
}
