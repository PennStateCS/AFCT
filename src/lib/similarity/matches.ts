// Finding submissions that are the same file, and saying how much that is worth.
//
// The rule that makes this safe to show a professor: a match is only interesting when it
// is RARE within the problem. Students converge on the same right answer, and a grammar or
// regular expression has no layout to differ in, so on an easy problem half the class can
// legitimately submit byte-identical work. Two students out of forty sharing a file is
// worth a look; twenty-five out of forty is what the answer looks like.
//
// Nothing here decides anything. It reports who matched whom and how common that content
// is, and the professor draws the conclusion. That is deliberate: an academic-integrity
// accusation is theirs to make, and the system has no way to tell a shared file from two
// students who worked it out the same way.

import { prisma } from '@/lib/prisma';

/** A student as the Similarity tab shows them. */
export type MatchStudent = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  cropX: number | null;
  cropY: number | null;
  zoom: number | null;
};

export type MatchSubmission = {
  id: string;
  submittedAt: string;
  assignmentId: string;
  fileName: string | null;
  originalFileName: string | null;
  /**
   * Short handle for the exact file. Two submissions in a match sharing this are byte for
   * byte the same; two that differ are the same machine drawn differently.
   */
  contentKey: string;
  student: MatchStudent;
  studentGroup: { id: string; name: string } | null;
};

export type SubmissionMatchGroup = {
  /** Short, stable label for this set of identical files. Not the hash itself. */
  matchId: string;
  problem: { id: string; title: string | null; type: string | null };
  /** How many different students submitted this exact content. Always 2 or more. */
  studentCount: number;
  /** How many different students have submitted this problem at all: the denominator. */
  problemStudentCount: number;
  /**
   * The largest number of students in this match who submitted the byte-identical file.
   * Equal to `studentCount` when the whole match is one file, and 1 when every student's
   * file differs in some incidental way.
   */
  identicalStudentCount: number;
  /**
   * The shortest time between two different students submitting this same content, in
   * milliseconds. Context, not a verdict: six minutes apart reads differently from three
   * weeks apart, and the reader is the one who knows which of those matters here.
   */
  closestGapMs: number | null;
  submissions: MatchSubmission[];
};

const studentSelect = {
  id: true,
  firstName: true,
  lastName: true,
  avatar: true,
  cropX: true,
  cropY: true,
  zoom: true,
} as const;

/**
 * Groups of submissions that share their exact content, for the problems given.
 *
 * Scoped by problem id, and a problem belongs to exactly one course, so this can never
 * reach across into another instructor's course. Matching happens at read time rather than
 * being stamped on a submission when it is graded: a stamp would only ever mark the second
 * student of a pair, and would go stale the moment anything else was submitted.
 *
 * Ordered rarest first, which is the order a professor wants to read them in.
 */
export async function findSubmissionMatches(
  problemIds: string[],
  problems: Map<string, { title: string | null; type: string | null }>,
): Promise<SubmissionMatchGroup[]> {
  if (problemIds.length === 0) return [];

  // One row per (problem, shape, student), so a student who submits five times counts once.
  // This is also what gives the denominator below without a second read.
  //
  // Grouped on the SHAPE rather than the exact bytes: a copied file that has had its nodes
  // dragged about or its states renamed is still the same work, and belongs in the same
  // match as the file it came from. Which of them are byte-identical is recorded inside the
  // group instead, because that is a different claim and reads differently.
  const perStudent = await prisma.submission.groupBy({
    by: ['problemId', 'shapeHash', 'contentHash', 'studentId'],
    where: { problemId: { in: problemIds }, contentHash: { not: null } },
  });

  const studentsPerProblem = new Map<string, Set<string>>();
  const studentsPerShape = new Map<string, Set<string>>();
  for (const row of perStudent) {
    if (!row.contentHash) continue;
    const problemStudents = studentsPerProblem.get(row.problemId) ?? new Set<string>();
    problemStudents.add(row.studentId);
    studentsPerProblem.set(row.problemId, problemStudents);

    // A file with no shape (a regular expression, or one that would not parse) can still be
    // matched on its exact contents, so it groups under its own hash.
    const key = `${row.problemId}:${row.shapeHash ?? `exact-${row.contentHash}`}`;
    const shapeStudents = studentsPerShape.get(key) ?? new Set<string>();
    shapeStudents.add(row.studentId);
    studentsPerShape.set(key, shapeStudents);
  }

  // Only work two or more different students submitted. One student's own resubmissions are
  // not a match with anybody.
  const sharedKeys = [...studentsPerShape.entries()].filter(([, students]) => students.size > 1);
  if (sharedKeys.length === 0) return [];

  const sharedShapes: string[] = [];
  const sharedContents: string[] = [];
  for (const [key] of sharedKeys) {
    const value = key.slice(key.indexOf(':') + 1);
    if (value.startsWith('exact-')) sharedContents.push(value.slice('exact-'.length));
    else sharedShapes.push(value);
  }

  const submissions = await prisma.submission.findMany({
    where: {
      problemId: { in: problemIds },
      OR: [
        ...(sharedShapes.length ? [{ shapeHash: { in: sharedShapes } }] : []),
        ...(sharedContents.length ? [{ contentHash: { in: sharedContents } }] : []),
      ],
    },
    orderBy: { submittedAt: 'desc' },
    select: {
      id: true,
      problemId: true,
      contentHash: true,
      shapeHash: true,
      assignmentId: true,
      submittedAt: true,
      fileName: true,
      originalFileName: true,
      studentId: true,
      studentGroupId: true,
      student: { select: studentSelect },
      studentGroup: { select: { id: true, name: true } },
    },
  });

  const groups = new Map<string, SubmissionMatchGroup>();
  // Which student group (if any) owns each submission in a match, and when each landed.
  const groupOwners = new Map<string, Set<string | null>>();
  const submissionTimes = new Map<string, { studentId: string; at: number }[]>();

  // Distinct students per exact file within a match, for the "and these two are the same
  // file" claim the group carries.
  const studentsPerContentInGroup = new Map<string, Map<string, Set<string>>>();

  for (const submission of submissions) {
    const shapeKey = submission.shapeHash ?? `exact-${submission.contentHash}`;
    const key = `${submission.problemId}:${shapeKey}`;
    // Work shared in one problem can appear in another where only one student used it; that
    // is not a match, so skip it rather than reporting a group of one.
    const students = studentsPerShape.get(key);
    if (!students || students.size < 2) continue;

    const group =
      groups.get(key) ??
      ({
        // The hash is an internal value and long; the reader only needs a stable handle.
        matchId: shapeKey.slice(0, 8),
        problem: {
          id: submission.problemId,
          title: problems.get(submission.problemId)?.title ?? null,
          type: problems.get(submission.problemId)?.type ?? null,
        },
        studentCount: students.size,
        problemStudentCount: studentsPerProblem.get(submission.problemId)?.size ?? 0,
        identicalStudentCount: 1,
        closestGapMs: null,
        submissions: [],
      } satisfies SubmissionMatchGroup);

    group.submissions.push({
      id: submission.id,
      submittedAt: submission.submittedAt.toISOString(),
      assignmentId: submission.assignmentId,
      fileName: submission.fileName,
      originalFileName: submission.originalFileName,
      contentKey: (submission.contentHash ?? '').slice(0, 8),
      student: submission.student,
      studentGroup: submission.studentGroup,
    });
    groups.set(key, group);

    const perContent = studentsPerContentInGroup.get(key) ?? new Map<string, Set<string>>();
    const sameFile = perContent.get(submission.contentHash ?? '') ?? new Set<string>();
    sameFile.add(submission.studentId);
    perContent.set(submission.contentHash ?? '', sameFile);
    studentsPerContentInGroup.set(key, perContent);

    const owners = groupOwners.get(key) ?? new Set<string | null>();
    owners.add(submission.studentGroupId);
    groupOwners.set(key, owners);

    const times = submissionTimes.get(key) ?? [];
    times.push({ studentId: submission.studentId, at: submission.submittedAt.getTime() });
    submissionTimes.set(key, times);
  }

  const reportable: SubmissionMatchGroup[] = [];
  for (const [key, group] of groups) {
    // Teammates on a group assignment: every member's submit writes its own row against the
    // shared set, so the whole team holding the same file is the feature working, not a
    // finding. Dropped only when EVERY submission belongs to that one group; a match that
    // reaches outside the team is still a match.
    const owners = groupOwners.get(key);
    const onlyOwner = owners?.size === 1 ? [...owners][0] : undefined;
    if (onlyOwner) continue;

    group.closestGapMs = closestGap(submissionTimes.get(key) ?? []);
    group.identicalStudentCount = Math.max(
      1,
      ...[...(studentsPerContentInGroup.get(key)?.values() ?? [])].map((set) => set.size),
    );
    reportable.push(group);
  }

  // Rarest first, then the most recent activity, so what needs reading is at the top and a
  // problem the whole class answered identically sinks to the bottom.
  return reportable.sort(
    (a, b) =>
      a.studentCount - b.studentCount ||
      (b.submissions[0]?.submittedAt ?? '').localeCompare(a.submissions[0]?.submittedAt ?? ''),
  );
}

/**
 * The shortest interval between two DIFFERENT students submitting this content. One
 * student's own resubmissions are minutes apart by nature and would drown the signal.
 */
function closestGap(times: { studentId: string; at: number }[]): number | null {
  let closest: number | null = null;
  for (let i = 0; i < times.length; i++) {
    for (let j = i + 1; j < times.length; j++) {
      const a = times[i]!;
      const b = times[j]!;
      if (a.studentId === b.studentId) continue;
      const gap = Math.abs(a.at - b.at);
      if (closest === null || gap < closest) closest = gap;
    }
  }
  return closest;
}
