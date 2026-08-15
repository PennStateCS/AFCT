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
import { Prisma } from '@prisma/client';
import { findNearMatches, type NearMatchInput } from './near-matches';
import { PROVENANCE_FEATURE_VERSION, type ProvenanceFeatures } from './provenance';

// Re-exported for the server side, which has no reason to know the rule moved. Client
// components must import it from './rarity' directly: this module reaches for Prisma.
export { isCommon, COMMON_SHARE } from './rarity';

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
  /** Whether the autograder marked this attempt correct. Null while it is still pending. */
  correct: boolean | null;
  /**
   * Which of this student's attempts at the problem this was, counting from one. A file that
   * matches somebody else's on a first attempt reads differently from one that appears on a
   * fourth, and the tab has no other way to show that.
   */
  attempt: number | null;
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
  /**
   * How the submissions were found to go together.
   *
   * `same-work` covers the two exact checks: the same file, or the same work once layout and
   * names are set aside. `near` is the third check, which finds pairs that share uncommon
   * structure without being equal, and is the only kind that carries evidence, because it is
   * the only one where "why is this here" is not obvious from the counts.
   */
  kind: 'same-work' | 'near';
  /** Factual statements about what the two submissions share. Near matches only. */
  evidence: string[];
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
  /**
   * A student submitted the byte-identical file AFTER another student's copy of it had
   * already been marked correct.
   *
   * This is the shape of the thing a large course is most likely to miss: submit, see the
   * autograder say full marks, pass the file on. It is still not a verdict, and the reader
   * still has to decide what it means, but it is a materially different situation from two
   * people arriving at the same answer, and it sorts to the top because of that.
   */
  reusedAfterPass: boolean;
  /**
   * This work IS the problem's own reference solution, byte for byte or once layout is set
   * aside. Everybody who has the answer file has the same work by definition, so a reader
   * needs to know that before reading anything into the match.
   */
  matchesAnswerFile: boolean;
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
  problems: Map<
    string,
    {
      title: string | null;
      type: string | null;
      answerContentHash?: string | null;
      answerShapeHash?: string | null;
    }
  >,
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
      correct: true,
      fileName: true,
      originalFileName: true,
      studentId: true,
      studentGroupId: true,
      student: { select: studentSelect },
      studentGroup: { select: { id: true, name: true } },
    },
  });

  // Which attempt each matched submission was for its student. One query over the students
  // and problems already in play, so it stays proportional to the matches, not the course.
  const attemptNumbers = await numberAttempts(submissions);

  const groups = new Map<string, SubmissionMatchGroup>();
  // Which student group (if any) owns each submission in a match, and when each landed.
  const groupOwners = new Map<string, Set<string | null>>();
  const submissionTimes = new Map<string, TimedSubmission[]>();

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
        kind: 'same-work' as const,
        evidence: [],
        problem: {
          id: submission.problemId,
          title: problems.get(submission.problemId)?.title ?? null,
          type: problems.get(submission.problemId)?.type ?? null,
        },
        studentCount: students.size,
        problemStudentCount: studentsPerProblem.get(submission.problemId)?.size ?? 0,
        identicalStudentCount: 1,
        closestGapMs: null,
        reusedAfterPass: false,
        matchesAnswerFile:
          (!!submission.contentHash &&
            submission.contentHash === problems.get(submission.problemId)?.answerContentHash) ||
          (!!submission.shapeHash &&
            submission.shapeHash === problems.get(submission.problemId)?.answerShapeHash),
        submissions: [],
      } satisfies SubmissionMatchGroup);

    group.submissions.push({
      id: submission.id,
      submittedAt: submission.submittedAt.toISOString(),
      assignmentId: submission.assignmentId,
      correct: submission.correct,
      attempt: attemptNumbers.get(submission.id) ?? null,
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
    times.push({
      studentId: submission.studentId,
      at: submission.submittedAt.getTime(),
      correct: submission.correct,
      contentHash: submission.contentHash ?? '',
    });
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

    const times = submissionTimes.get(key) ?? [];
    group.closestGapMs = closestGap(times);
    group.reusedAfterPass = wasReusedAfterPassing(times);
    group.identicalStudentCount = Math.max(
      1,
      ...[...(studentsPerContentInGroup.get(key)?.values() ?? [])].map((set) => set.size),
    );
    reportable.push(group);
  }

  // The third check, over everything the first two left behind.
  reportable.push(...(await findNearMatchGroups(problemIds, problems, attemptNumbers)));

  // Work that was reused after it had already passed comes first whatever its size: it is
  // the case a large course is most likely to miss. Then rarest first, so what needs reading
  // is at the top and a problem the whole class answered identically sinks to the bottom.
  return reportable.sort(
    (a, b) =>
      Number(b.reusedAfterPass) - Number(a.reusedAfterPass) ||
      a.studentCount - b.studentCount ||
      (b.submissions[0]?.submittedAt ?? '').localeCompare(a.submissions[0]?.submittedAt ?? ''),
  );
}

/**
 * Number every matched submission within its student's attempts at that problem.
 *
 * Counted over all of a student's attempts, not only the matched ones: "their third
 * attempt" has to mean their third, or it is worse than saying nothing.
 */
async function numberAttempts(
  matched: { id: string; problemId: string; studentId: string }[],
): Promise<Map<string, number>> {
  const numbers = new Map<string, number>();
  if (matched.length === 0) return numbers;

  const attempts = await prisma.submission.findMany({
    where: {
      OR: [
        ...new Set(matched.map((row) => `${row.problemId}:${row.studentId}`)),
      ].map((pair) => {
        const [problemId, studentId] = pair.split(':') as [string, string];
        return { problemId, studentId };
      }),
    },
    orderBy: { submittedAt: 'asc' },
    select: { id: true, problemId: true, studentId: true },
  });

  const seen = new Map<string, number>();
  for (const attempt of attempts) {
    const key = `${attempt.problemId}:${attempt.studentId}`;
    const next = (seen.get(key) ?? 0) + 1;
    seen.set(key, next);
    numbers.set(attempt.id, next);
  }
  return numbers;
}

type TimedSubmission = {
  studentId: string;
  at: number;
  correct: boolean | null;
  contentHash: string;
};

/**
 * Did somebody submit the byte-identical file after another student's copy had already been
 * marked correct?
 *
 * Byte-identical, not merely the same work: the claim is that this exact file had already
 * been shown to pass, which is only true of the file itself. Ordering alone, with no gap
 * limit: a file passed along a week later is the same act as one passed along in the corridor.
 */
function wasReusedAfterPassing(times: TimedSubmission[]): boolean {
  return times.some((later) =>
    times.some(
      (earlier) =>
        earlier.correct === true &&
        earlier.studentId !== later.studentId &&
        earlier.contentHash === later.contentHash &&
        earlier.at < later.at,
    ),
  );
}

/**
 * The shortest interval between two DIFFERENT students submitting this content. One
 * student's own resubmissions are minutes apart by nature and would drown the signal.
 */
function closestGap(times: TimedSubmission[]): number | null {
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


/**
 * Pairs that share uncommon structure without being equal.
 *
 * Read in the same breath as the exact checks, from the features stored at upload, so the
 * grading path carries none of this. One pair is one group of two, because the evidence is
 * about those two files: rolling several pairs into a cluster would attach a sentence like
 * "9 of 10 transitions match" to submissions it was never measured against.
 */
async function findNearMatchGroups(
  problemIds: string[],
  problems: Map<
    string,
    {
      title: string | null;
      type: string | null;
      answerContentHash?: string | null;
      answerShapeHash?: string | null;
    }
  >,
  attemptNumbers: Map<string, number>,
): Promise<SubmissionMatchGroup[]> {
  const rows = await prisma.submission.findMany({
    where: { problemId: { in: problemIds }, provenanceFeatures: { not: Prisma.DbNull } },
    orderBy: { submittedAt: 'asc' },
    select: {
      id: true,
      problemId: true,
      studentId: true,
      studentGroupId: true,
      submittedAt: true,
      correct: true,
      assignmentId: true,
      fileName: true,
      originalFileName: true,
      contentHash: true,
      shapeHash: true,
      provenanceFeatures: true,
      student: { select: studentSelect },
      studentGroup: { select: { id: true, name: true } },
    },
  });

  // The exact checks only numbered the submissions they matched, and a near match usually
  // involves different ones, so number these too rather than showing a blank where the other
  // cards show "Submission 3".
  const nearAttempts = await numberAttempts(rows);

  const groups: SubmissionMatchGroup[] = [];

  // A problem at a time: a match only means something among students answering the same
  // question, and the rarity weighting needs one cohort to count against.
  for (const problemId of problemIds) {
    const forProblem = rows.filter((row) => row.problemId === problemId);
    if (forProblem.length < 2) continue;

    const studentsInProblem = new Set(forProblem.map((row) => row.studentId)).size;

    const inputs: NearMatchInput[] = [];
    for (const row of forProblem) {
      const features = row.provenanceFeatures as unknown as ProvenanceFeatures | null;
      // Only the version this code understands. An older row is left out rather than
      // compared under rules it was not extracted with.
      if (!features || features.version !== PROVENANCE_FEATURE_VERSION) continue;
      inputs.push({
        id: row.id,
        studentId: row.studentId,
        studentGroupId: row.studentGroupId,
        submittedAt: row.submittedAt,
        // Already grouped by an exact or shape match, so a near match would say it twice.
        shapeKey: row.shapeHash ?? (row.contentHash ? `exact-${row.contentHash}` : null),
        features,
      });
    }

    const byId = new Map(forProblem.map((row) => [row.id, row]));

    for (const near of findNearMatches(inputs)) {
      const pair = [byId.get(near.a.id), byId.get(near.b.id)].filter(
        (row): row is (typeof forProblem)[number] => Boolean(row),
      );
      if (pair.length !== 2) continue;

      groups.push({
        matchId: `near-${near.a.id.slice(-4)}${near.b.id.slice(-4)}`,
        kind: 'near',
        evidence: near.evidence.map((item) => item.detail),
        problem: {
          id: problemId,
          title: problems.get(problemId)?.title ?? null,
          type: problems.get(problemId)?.type ?? null,
        },
        studentCount: 2,
        problemStudentCount: studentsInProblem,
        // Neither is the other's file; that is what makes this the third check.
        identicalStudentCount: 1,
        closestGapMs: Math.abs(
          near.a.submittedAt.getTime() - near.b.submittedAt.getTime(),
        ),
        reusedAfterPass: pair.some((row) =>
          pair.some(
            (other) =>
              other.correct === true &&
              other.studentId !== row.studentId &&
              other.submittedAt < row.submittedAt,
          ),
        ),
        matchesAnswerFile: false,
        submissions: pair
          .slice()
          .sort((x, y) => y.submittedAt.getTime() - x.submittedAt.getTime())
          .map((row) => ({
            id: row.id,
            submittedAt: row.submittedAt.toISOString(),
            correct: row.correct,
            attempt: attemptNumbers.get(row.id) ?? nearAttempts.get(row.id) ?? null,
            assignmentId: row.assignmentId,
            fileName: row.fileName,
            originalFileName: row.originalFileName,
            contentKey: (row.contentHash ?? '').slice(0, 8),
            student: row.student,
            studentGroup: row.studentGroup,
          })),
      });
    }
  }

  return groups;
}
