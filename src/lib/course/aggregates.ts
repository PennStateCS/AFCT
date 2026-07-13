// src/lib/course/aggregates.ts
//
// Submission/comment roll-ups for the course GET view. Each helper prefers a single
// grouped aggregate but degrades gracefully: a delegate (or partial test mock) without
// `groupBy` falls back to `findMany`, and without that to a per-item query. This
// three-step ladder was copy-pasted three times inside the course route; it lives here
// once so the resilience is defined (and testable) in one place.

export type CountRow = {
  studentId?: string | null;
  assignmentId?: string | null;
  _count?: { _all?: number } | null;
};

/**
 * A prisma delegate whose aggregate methods are treated as optional, so callers can
 * fall back to a per-item query when a partial mock doesn't implement them.
 */
export type OptionalCountDelegate = {
  groupBy?: (args: unknown) => Promise<CountRow[]>;
  findMany?: (args: unknown) => Promise<CountRow[]>;
};

/**
 * The set of student ids that have any submission across the given assignments. Prefers
 * a grouped/`findMany` query; falls back to a per-student existence check.
 */
export async function studentsWithSubmissions(
  delegate: OptionalCountDelegate,
  studentIds: string[],
  assignmentIds: string[],
  hasAnySubmission: (studentId: string) => Promise<boolean>,
): Promise<Set<string>> {
  if (studentIds.length === 0 || assignmentIds.length === 0) return new Set();

  const where = { studentId: { in: studentIds }, assignmentId: { in: assignmentIds } };
  const rows = delegate.groupBy
    ? await delegate.groupBy({ by: ['studentId'], where })
    : delegate.findMany
      ? await delegate.findMany({ where, select: { studentId: true } })
      : await Promise.all(
          studentIds.map(async (studentId) => ((await hasAnySubmission(studentId)) ? { studentId } : null)),
        ).then((rows) => rows.filter((row): row is { studentId: string } => !!row));

  return new Set(rows.map((row: CountRow) => String(row.studentId)));
}

/**
 * A map of assignmentId → count, summed across the given assignments. Prefers a grouped
 * `_count` aggregate; falls back to `findMany` (one row per record) or a per-assignment
 * `count()`.
 */
export async function countByAssignment(
  delegate: OptionalCountDelegate,
  assignmentIds: string[],
  countOne: (assignmentId: string) => Promise<number>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (assignmentIds.length === 0) return map;

  const where = { assignmentId: { in: assignmentIds } };
  const rows = delegate.groupBy
    ? await delegate.groupBy({ by: ['assignmentId'], where, _count: { _all: true } })
    : delegate.findMany
      ? await delegate.findMany({ where, select: { assignmentId: true } })
      : await Promise.all(
          assignmentIds.map(async (assignmentId) => ({
            assignmentId,
            _count: { _all: await countOne(assignmentId) },
          })),
        );

  rows.forEach((row: CountRow) => {
    const key = String(row.assignmentId);
    const increment = row?._count?._all ?? 1;
    map.set(key, (map.get(key) ?? 0) + increment);
  });
  return map;
}
