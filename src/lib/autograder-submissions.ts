import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { effectiveDeadline } from '@/lib/effective-deadline';

/**
 * One page of the Autograder page's table, with search, filters and sort applied in the
 * database. The page spans every course, so the unpaginated version of this query returned
 * every autograded submission in the installation; everything here exists to keep that
 * bounded.
 *
 * Kept in step with the chips in `lib/submission-status.ts`, which are what the table
 * actually renders. `STATUS_WHERE` below is the server-side twin of `getReviewStatusChip`,
 * and the timing filter is the twin of `getTimingStatusChip`. If either chip changes, this
 * file changes with it or the filter stops agreeing with the badge beside it.
 */

/** Timing filter tokens. The twin of `getTimingStatusChip`'s two labels. */
export type AutograderTiming = 'ontime' | 'late';

/** Status filter tokens. The twin of `getReviewStatusChip`'s five labels. */
export type AutograderStatus = 'pending' | 'processing' | 'failed' | 'correct' | 'incorrect';

/** Search scope: 'all' spans every field listed in `SEARCH_CLAUSES`. */
export type AutograderSearchField =
  'all' | 'student' | 'course' | 'assignment' | 'problem' | 'file';

export type AutograderSubmissionRow = {
  id: string;
  studentId: string;
  courseId: string;
  assignmentId: string;
  problemId: string;
  studentFirstName: string | null;
  studentLastName: string | null;
  studentEmail: string;
  courseName: string;
  assignmentTitle: string;
  problemTitle: string;
  /**
   * The due date this student is held to, so the client can render Timing without loading
   * assignments or knowing about overrides. A student with an extension carries their own date
   * here, not the assignment's.
   */
  dueDate: string;
  /** Decides which viewer the file opens in (JFLAP vs the RE/CFG editors). */
  problemType: string | null;
  submittedAt: string;
  status: string;
  correct: boolean | null;
  feedback: string | null;
  /** The student's standing grade for the problem, or null when nothing is recorded. */
  grade: number | null;
  /** False when the problem is hand-graded, so the row has no queue state to report. */
  autograderEnabled: boolean;
  /** True when the assignment is group work. */
  isGroupAssignment: boolean;
  maxPoints: number | null;
  fileName: string | null;
  originalFileName: string | null;
};

export type AutograderPageParams = {
  skip: number;
  take: number;
  // Scope, narrowest level wins. An empty or absent list means "no constraint at this
  // level", which is how the page says "everything" without enumerating every id.
  courseIds?: string[];
  assignmentIds?: string[];
  problemIds?: string[];
  q?: string;
  field?: AutograderSearchField;
  // Multi-selects: the still-allowed values. Empty (or every value) means no constraint.
  timing?: AutograderTiming[];
  status?: AutograderStatus[];
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
};

// The exact column set the table needs. Shared by the row query so the select and the
// mapper below cannot drift.
const SUBMISSION_LIST_SELECT = {
  id: true,
  studentId: true,
  courseId: true,
  assignmentId: true,
  problemId: true,
  correct: true,
  feedback: true,
  submittedAt: true,
  status: true,
  fileName: true,
  originalFileName: true,
  student: { select: { email: true, firstName: true, lastName: true } },
  course: { select: { name: true } },
  assignmentProblem: {
    select: {
      maxPoints: true,
      // Whether the autograder was ever going to touch this, and whether the assignment is
      // group work. Both are columns on the page now.
      autograderEnabled: true,
      assignment: { select: { title: true, dueDate: true, groupSetId: true } },
      problem: { select: { title: true, type: true } },
    },
  },
} satisfies Prisma.SubmissionSelect;

/**
 * Status tokens to real columns. The five UI values are not one column: three are queue
 * states and two split COMPLETED on `correct`. Incorrect deliberately includes a null
 * `correct`, matching `getReviewStatusChip`, which falls through to "Incorrect" for
 * anything COMPLETED that is not explicitly correct.
 */
const STATUS_WHERE: Record<AutograderStatus, Prisma.SubmissionWhereInput> = {
  pending: { status: 'PENDING' },
  processing: { status: 'PROCESSING' },
  failed: { status: 'FAILED' },
  correct: { status: 'COMPLETED', correct: true },
  incorrect: { status: 'COMPLETED', OR: [{ correct: false }, { correct: null }] },
};

/**
 * Sortable columns to Prisma orderBy. Ids match the table's column ids; anything else falls
 * back to newest-first. A stable `id` tiebreaker is appended by the caller so paging is
 * deterministic when the primary value ties.
 *
 * Three of the table's columns are deliberately absent, and are marked
 * `enableSorting: false` on the client to match:
 *   - `timing` is a comparison between two columns, not a column.
 *   - `attemptGrade` is derived (`correct ? maxPoints : 0`).
 *   - `grade` lives in AssignmentProblemGrade, which Submission has no relation to.
 * `status` sorts by the underlying queue state and then `correct`, which is not the same as
 * alphabetical order of the badge text.
 */
const SUBMISSION_ORDER_BY: Record<
  string,
  (dir: 'asc' | 'desc') => Prisma.SubmissionOrderByWithRelationInput[]
> = {
  submittedAt: (dir) => [{ submittedAt: dir }],
  student: (dir) => [{ student: { lastName: dir } }, { student: { firstName: dir } }],
  course: (dir) => [{ course: { name: dir } }],
  assignment: (dir) => [{ assignmentProblem: { assignment: { title: dir } } }],
  problem: (dir) => [{ assignmentProblem: { problem: { title: dir } } }],
  file: (dir) => [{ originalFileName: dir }],
  due: (dir) => [{ assignmentProblem: { assignment: { dueDate: dir } } }],
  status: (dir) => [{ status: dir }, { correct: dir }],
};

/** Which relations a search scope reaches into. 'all' is the union of the rest. */
function searchClauses(q: string, field: AutograderSearchField): Prisma.SubmissionWhereInput[] {
  const like = { contains: q, mode: 'insensitive' } as const;
  const clauses: Prisma.SubmissionWhereInput[] = [];
  const wants = (name: AutograderSearchField) => field === 'all' || field === name;

  if (wants('student')) {
    clauses.push(
      { student: { firstName: like } },
      { student: { lastName: like } },
      { student: { email: like } },
    );
  }
  if (wants('course')) clauses.push({ course: { name: like } });
  if (wants('assignment')) clauses.push({ assignmentProblem: { assignment: { title: like } } });
  if (wants('problem')) clauses.push({ assignmentProblem: { problem: { title: like } } });
  if (wants('file')) clauses.push({ originalFileName: like }, { fileName: like });
  return clauses;
}

/** The scope clause, narrowest supplied level wins. */
function scopeWhere(params: AutograderPageParams): Prisma.SubmissionWhereInput | null {
  if (params.problemIds?.length) return { problemId: { in: params.problemIds } };
  if (params.assignmentIds?.length) return { assignmentId: { in: params.assignmentIds } };
  if (params.courseIds?.length) return { courseId: { in: params.courseIds } };
  return null;
}

/**
 * The Late / On time clause.
 *
 * Timing compares `submittedAt` against the assignment's due date, and no database can
 * compare two columns through Prisma's query API, so we read the due dates for the
 * assignments in scope and emit one clause per assignment. That is an OR as wide as the
 * scope, which is why it is only built when the admin has actually picked one side: with
 * both values selected (or neither) the filter says nothing and we skip the query entirely.
 *
 * The date compared against is the one that applies to that student: a student with an
 * extension who submits inside it is on time, and the filter and the chip have to agree with
 * the rule submission acceptance uses or the page reports something that did not happen.
 */
/**
 * The due date each student is actually held to, for a set of assignments.
 *
 * The page shows Late or On time, and a student with an extension who submits inside it is on
 * time: showing them as late is a report of something that did not happen. Overrides are the
 * exception rather than the rule, so they are loaded whole for the assignments in scope and
 * the effective date is worked out from them, rather than asking per submission.
 *
 * Group overrides are expanded to their members here, because a submission names a student and
 * an override names a group.
 */
async function effectiveDueDates(assignmentIds: string[]): Promise<{
  /** Assignment id to the date that applies when nobody has an override. */
  base: Map<string, Date>;
  /** `assignmentId\u0000studentId` to the date that applies to them instead. */
  overridden: Map<string, Date>;
  /** Assignment id to the students whose date is not the base one. */
  overriddenStudents: Map<string, string[]>;
}> {
  const base = new Map<string, Date>();
  const overridden = new Map<string, Date>();
  const overriddenStudents = new Map<string, string[]>();
  if (assignmentIds.length === 0) return { base, overridden, overriddenStudents };

  const assignments = await prisma.assignment.findMany({
    where: { id: { in: assignmentIds } },
    select: {
      id: true,
      dueDate: true,
      unlockAt: true,
      allowLateSubmissions: true,
      lateCutoff: true,
      overrides: {
        select: {
          targetType: true,
          userId: true,
          groupId: true,
          unlockAt: true,
          dueDate: true,
          lateCutoff: true,
          allowLateSubmissions: true,
        },
      },
    },
  });

  // One lookup for every group named by an override, rather than one per override.
  const groupIds = [
    ...new Set(
      assignments.flatMap((a) =>
        a.overrides.flatMap((o) => (o.targetType === 'GROUP' && o.groupId ? [o.groupId] : [])),
      ),
    ),
  ];
  const memberships = groupIds.length
    ? await prisma.groupMembership.findMany({
        where: { groupId: { in: groupIds } },
        select: { groupId: true, userId: true },
      })
    : [];
  const membersOf = new Map<string, string[]>();
  for (const m of memberships) {
    membersOf.set(m.groupId, [...(membersOf.get(m.groupId) ?? []), m.userId]);
  }

  for (const assignment of assignments) {
    const fields = {
      dueDate: assignment.dueDate,
      unlockAt: assignment.unlockAt,
      allowLateSubmissions: assignment.allowLateSubmissions,
      lateCutoff: assignment.lateCutoff,
    };
    // Through the same resolver the submit path uses, so "on time here" and "accepted there"
    // cannot drift apart: it also clamps a due date that sits before the unlock.
    base.set(assignment.id, effectiveDeadline(fields, [], '__nobody__', []).dueDate);

    for (const override of assignment.overrides) {
      const students =
        override.targetType === 'STUDENT'
          ? override.userId
            ? [override.userId]
            : []
          : override.groupId
            ? (membersOf.get(override.groupId) ?? [])
            : [];
      for (const studentId of students) {
        const key = `${assignment.id}\u0000${studentId}`;
        // A student is never targeted more than one way for an assignment, and where the data
        // says otherwise the resolver's own precedence decides.
        if (overridden.has(key)) continue;
        const groupIdsForStudent = override.groupId ? [override.groupId] : [];
        overridden.set(
          key,
          effectiveDeadline(fields, [override], studentId, groupIdsForStudent).dueDate,
        );
        overriddenStudents.set(assignment.id, [
          ...(overriddenStudents.get(assignment.id) ?? []),
          studentId,
        ]);
      }
    }
  }

  return { base, overridden, overriddenStudents };
}

async function timingWhere(
  params: AutograderPageParams,
): Promise<Prisma.SubmissionWhereInput | null> {
  const timing = params.timing ?? [];
  if (timing.length !== 1) return null;
  const late = timing[0] === 'late';

  // The same scope as the rows, expressed against Assignment. Submission reaches an
  // assignment through AssignmentProblem, so there is no Assignment.submissions to filter on.
  const where: Prisma.AssignmentWhereInput = params.problemIds?.length
    ? { problems: { some: { problemId: { in: params.problemIds } } } }
    : params.assignmentIds?.length
      ? { id: { in: params.assignmentIds } }
      : params.courseIds?.length
        ? { courseId: { in: params.courseIds } }
        : {};

  const assignments = await prisma.assignment.findMany({ where, select: { id: true } });
  if (assignments.length === 0) return { id: { in: [] } };

  const { base, overridden, overriddenStudents } = await effectiveDueDates(
    assignments.map((a) => a.id),
  );

  /**
   * One clause per assignment for everybody on the base date, plus one per student whose date
   * is different. Bounded by the number of overrides, which are exceptions, rather than by the
   * number of submissions.
   */
  const clauses: Prisma.SubmissionWhereInput[] = [];
  for (const assignment of assignments) {
    const exceptions = overriddenStudents.get(assignment.id) ?? [];
    const baseDue = base.get(assignment.id);
    if (baseDue) {
      clauses.push({
        assignmentId: assignment.id,
        ...(exceptions.length ? { studentId: { notIn: exceptions } } : {}),
        submittedAt: late ? { gt: baseDue } : { lte: baseDue },
      });
    }
    for (const studentId of exceptions) {
      const due = overridden.get(`${assignment.id}\u0000${studentId}`);
      if (!due) continue;
      clauses.push({
        assignmentId: assignment.id,
        studentId,
        submittedAt: late ? { gt: due } : { lte: due },
      });
    }
  }

  return { OR: clauses };
}

/**
 * One page of autograded submissions plus the total matching count (for the pager).
 *
 * Problems with the autograder switched off are left out: a submission the autograder never
 * touches has no queue state and no per-attempt score to show here. Those still appear on
 * the course's own submissions tab.
 */
export async function getAutograderSubmissionsPage(
  params: AutograderPageParams,
): Promise<{ rows: AutograderSubmissionRow[]; total: number }> {
  // No autograder filter: this feeds the Submissions page, which lists everything a student
  // has handed in. A problem with the autograder switched off has no queue state, so its rows
  // report "Not autograded" instead.
  const and: Prisma.SubmissionWhereInput[] = [];

  const scope = scopeWhere(params);
  if (scope) and.push(scope);

  if (params.q) {
    const clauses = searchClauses(params.q, params.field ?? 'all');
    and.push(clauses.length ? { OR: clauses } : { id: { in: [] } });
  }

  // Within Status the picks widen (a row is exactly one of the five), so they OR. Timing is
  // a separate dimension and ANDs with them, which is what makes "Late" plus "Failed" narrow.
  const status = params.status ?? [];
  if (status.length > 0 && status.length < Object.keys(STATUS_WHERE).length) {
    and.push({ OR: status.map((token) => STATUS_WHERE[token]) });
  }

  const timing = await timingWhere(params);
  if (timing) and.push(timing);

  const where: Prisma.SubmissionWhereInput = { AND: and };

  const dir: 'asc' | 'desc' = params.sortDir === 'asc' ? 'asc' : 'desc';
  const build = SUBMISSION_ORDER_BY[params.sortBy ?? ''] ?? (() => [{ submittedAt: dir }]);
  const orderBy: Prisma.SubmissionOrderByWithRelationInput[] = [...build(dir), { id: 'asc' }];

  const [total, submissions] = await Promise.all([
    prisma.submission.count({ where }),
    prisma.submission.findMany({
      where,
      orderBy,
      skip: params.skip,
      take: params.take,
      select: SUBMISSION_LIST_SELECT,
    }),
  ]);

  // Recorded grades for this page only, matched on the exact (student, assignment, problem)
  // triples. The unpaginated version crossed three separate `in` lists, which pulled in every
  // grade whose student, assignment and problem each appeared somewhere in the result set.
  const gradeMap = new Map<string, number>();
  if (submissions.length > 0) {
    const grades = await prisma.assignmentProblemGrade.findMany({
      where: {
        OR: submissions.map((s) => ({
          studentId: s.studentId,
          assignmentId: s.assignmentId,
          problemId: s.problemId,
        })),
      },
      select: { studentId: true, assignmentId: true, problemId: true, grade: true },
    });
    for (const row of grades) {
      gradeMap.set(`${row.studentId}:${row.assignmentId}:${row.problemId}`, row.grade);
    }
  }

  /**
   * The date each row is judged against, which is the student's own.
   *
   * Two queries for the page rather than one per row: the assignments on the page are few, and
   * their overrides are exceptions. The client draws the Late / On time chip from this field,
   * so sending the effective date is what makes the chip right without the client learning
   * about overrides at all.
   */
  const dueDates = await effectiveDueDates([...new Set(submissions.map((s) => s.assignmentId))]);
  const dueFor = (assignmentId: string, studentId: string, fallback: Date) =>
    dueDates.overridden.get(`${assignmentId}\u0000${studentId}`) ??
    dueDates.base.get(assignmentId) ??
    fallback;

  const rows = submissions.map((s) => ({
    id: s.id,
    studentId: s.studentId,
    courseId: s.courseId,
    assignmentId: s.assignmentId,
    problemId: s.problemId,
    studentFirstName: s.student.firstName,
    studentLastName: s.student.lastName,
    studentEmail: s.student.email,
    courseName: s.course.name,
    assignmentTitle: s.assignmentProblem.assignment.title,
    problemTitle: s.assignmentProblem.problem.title,
    dueDate: dueFor(
      s.assignmentId,
      s.studentId,
      s.assignmentProblem.assignment.dueDate,
    ).toISOString(),
    problemType: s.assignmentProblem.problem.type,
    submittedAt: s.submittedAt.toISOString(),
    status: s.status,
    correct: s.correct,
    feedback: s.feedback,
    grade: gradeMap.get(`${s.studentId}:${s.assignmentId}:${s.problemId}`) ?? null,
    maxPoints: s.assignmentProblem.maxPoints,
    autograderEnabled: s.assignmentProblem.autograderEnabled,
    isGroupAssignment: !!s.assignmentProblem.assignment.groupSetId,
    fileName: s.fileName,
    originalFileName: s.originalFileName,
  }));

  return { rows, total };
}
