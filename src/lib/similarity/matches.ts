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
import type { ReviewSubject } from './rarity';

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
   * Short handle for the file's normalised contents. Two submissions in a match sharing this
   * are the same file once formatting is set aside; two that differ are the same machine
   * drawn differently. Whether the raw bytes agree is a stricter question, answered for the
   * group as a whole by `byteIdenticalStudentCount`.
   */
  contentKey: string;
  /**
   * Which set of byte-identical files this submission belongs to, within its own match:
   * `b1`, `b2`, and so on. Two submissions in a match sharing this were the same file to the
   * byte; two that differ were not.
   *
   * Null when the raw file was never hashed, which is every submission stored before that
   * column existed, and which means "not known" rather than "different".
   *
   * A label made up for the response rather than the hash itself: the page needs to know
   * which submissions go together, and nothing else, so nothing else is sent.
   */
  byteKey: string | null;
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
  /**
   * How big the work is: two students landing on the same three-state machine is a different
   * proposition from two landing on the same eleven-state one, and a reader needs the size to
   * judge which they are looking at. Empty when the artifact carried no description.
   */
  stateCount: number | null;
  transitionCount: number | null;
  problem: { id: string; title: string | null; type: string | null };
  /** How many different students submitted this exact content. Always 2 or more. */
  studentCount: number;
  /** How many different students have submitted this problem at all: the denominator. */
  problemStudentCount: number;
  /**
   * The same two counts for a group assignment, where the thing being reviewed is a group
   * rather than a person: any member may submit for the team, so counting members would say
   * "4 of 30 students" about what is really two groups out of nine.
   *
   * Both 0 when no submission here belongs to a group, which is every individual assignment.
   */
  groupCount: number;
  problemGroupCount: number;
  /**
   * The largest number of students in this match who submitted the same file once formatting
   * is set aside. Equal to `studentCount` when the whole match is one file, and 1 when every
   * student's file differs in some incidental way.
   */
  identicalStudentCount: number;
  /**
   * The largest number of students in this match whose files are identical byte for byte,
   * nothing normalised away.
   *
   * The strictest thing the detector can say, and the only one that needs no qualifier: not
   * "the same work", not "the same file once formatting is set aside", the same bytes. Always
   * at most `identicalStudentCount`, because identical bytes normalise to identical contents.
   *
   * 1 when no two agree AND when nobody's file has been hashed yet, which is every submission
   * stored before the column existed. The page has no way to tell those apart, so it says
   * nothing rather than guessing; a backfill is what turns the old rows into an answer.
   */
  byteIdenticalStudentCount: number;
  /**
   * The shortest time between two different students submitting this same content, in
   * milliseconds. Context, not a verdict: six minutes apart reads differently from three
   * weeks apart, and the reader is the one who knows which of those matters here.
   */
  closestGapMs: number | null;
  /**
   * A student submitted the same file AFTER another student's copy of it had already been
   * marked correct.
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
 * Options for a caller that wants the same matches, minus what only a rendered card needs.
 *
 * Deliberately not a second, cheaper matching rule: every group, every count and every
 * classification is produced by the same code either way, because a badge that disagreed
 * with the page it points at would be worse than no badge. The only thing `countOnly` drops
 * is attempt numbering, which is two reads spent on a sentence nobody is going to see.
 */
export type FindMatchesOptions = {
  countOnly?: boolean;
  /**
   * Who the finding is about. Group work is counted by team, because any member may submit
   * for the team and counting members would both inflate a match and make the class look
   * larger than it is. Defaults to students.
   */
  subject?: ReviewSubject;
};

/**
 * Groups of submissions that share their exact content, for one assignment's problems.
 *
 * Scoped by assignment AND problem, on every read. A problem is reusable, so the same
 * question can be set again next term or in another section, and work submitted to a
 * different assignment is a different piece of work: reporting it as a match would put two
 * students who never took the same assignment on one card. The assignment also belongs to
 * exactly one course, so this can never reach across into another instructor's course.
 *
 * Matching happens at read time rather than being stamped on a submission when it is graded:
 * a stamp would only ever mark the second student of a pair, and would go stale the moment
 * anything else was submitted.
 *
 * Ordered rarest first, which is the order a professor wants to read them in.
 */
export async function findSubmissionMatches(
  assignmentId: string,
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
  options: FindMatchesOptions = {},
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
    by: ['problemId', 'shapeHash', 'contentHash', 'studentId', 'studentGroupId'],
    where: { assignmentId, problemId: { in: problemIds }, contentHash: { not: null } },
  });

  const studentsPerProblem = new Map<string, Set<string>>();
  const studentsPerShape = new Map<string, Set<string>>();
  // The same two tallies counted by team, for a group assignment. Empty for an individual
  // one, where no submission carries a group.
  const groupsPerProblem = new Map<string, Set<string>>();
  const groupsPerShape = new Map<string, Set<string>>();
  for (const row of perStudent) {
    if (!row.contentHash) continue;
    const problemStudents = studentsPerProblem.get(row.problemId) ?? new Set<string>();
    problemStudents.add(row.studentId);
    studentsPerProblem.set(row.problemId, problemStudents);
    if (row.studentGroupId) {
      const problemGroups = groupsPerProblem.get(row.problemId) ?? new Set<string>();
      problemGroups.add(row.studentGroupId);
      groupsPerProblem.set(row.problemId, problemGroups);
    }

    // A file with no shape (a regular expression, or one that would not parse) can still be
    // matched on its exact contents, so it groups under its own hash.
    const key = `${row.problemId}:${row.shapeHash ?? `exact-${row.contentHash}`}`;
    const shapeStudents = studentsPerShape.get(key) ?? new Set<string>();
    shapeStudents.add(row.studentId);
    studentsPerShape.set(key, shapeStudents);
    if (row.studentGroupId) {
      const shapeGroups = groupsPerShape.get(key) ?? new Set<string>();
      shapeGroups.add(row.studentGroupId);
      groupsPerShape.set(key, shapeGroups);
    }
  }

  // Only work two or more different students submitted. One student's own resubmissions are
  // not a match with anybody.
  //
  // No early return when there is nothing here: the third check runs over what these two
  // leave behind, and a problem where nobody submitted the same file is exactly where it has
  // something to say. Returning here skipped it entirely.
  const sharedKeys = [...studentsPerShape.entries()].filter(([, students]) => students.size > 1);

  const sharedShapes: string[] = [];
  const sharedContents: string[] = [];
  for (const [key] of sharedKeys) {
    const value = key.slice(key.indexOf(':') + 1);
    if (value.startsWith('exact-')) sharedContents.push(value.slice('exact-'.length));
    else sharedShapes.push(value);
  }

  const submissions =
    sharedKeys.length === 0
      ? []
      : await prisma.submission.findMany({
          where: {
            assignmentId,
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
            byteHash: true,
            assignmentId: true,
            submittedAt: true,
            correct: true,
            evaluatedAt: true,
            fileName: true,
            originalFileName: true,
            studentId: true,
            studentGroupId: true,
            provenanceFeatures: true,
            student: { select: studentSelect },
            studentGroup: { select: { id: true, name: true } },
          },
        });

  // Which attempt each matched submission was for its student. One query over the students
  // and problems already in play, so it stays proportional to the matches, not the course.
  const attemptNumbers = await numberAttempts(assignmentId, submissions, options);

  const groups = new Map<string, SubmissionMatchGroup>();
  // Which student group (if any) owns each submission in a match, and when each landed.
  const groupOwners = new Map<string, Set<string | null>>();
  const submissionTimes = new Map<string, TimedSubmission[]>();

  // The raw hash of each matched submission, kept here rather than on the row it describes:
  // the page is told which submissions agree, not what they hash to.
  const byteHashes = new Map<string, string | null>();
  // Distinct students per exact file within a match, for the "and these two are the same
  // file" claim the group carries.
  const studentsPerContentInGroup = new Map<string, Map<string, Set<string>>>();
  // The same, one step stricter: distinct students per raw file. Keyed only where a byte hash
  // exists. A submission stored before the column did have a null one, and bucketing those
  // together under a shared placeholder the way the content map does would report unhashed
  // files as identical, which is precisely the overclaim this check exists to remove.
  const studentsPerByteInGroup = new Map<string, Map<string, Set<string>>>();

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
        ...sizeOf(submission.provenanceFeatures),
        problem: {
          id: submission.problemId,
          title: problems.get(submission.problemId)?.title ?? null,
          type: problems.get(submission.problemId)?.type ?? null,
        },
        studentCount: students.size,
        problemStudentCount: studentsPerProblem.get(submission.problemId)?.size ?? 0,
        groupCount: groupsPerShape.get(key)?.size ?? 0,
        problemGroupCount: groupsPerProblem.get(submission.problemId)?.size ?? 0,
        identicalStudentCount: 1,
        byteIdenticalStudentCount: 1,
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
      // Filled in below, once the whole group is known: the label is per match, so it cannot
      // be worked out one row at a time.
      byteKey: null,
      student: submission.student,
      studentGroup: submission.studentGroup,
    });
    byteHashes.set(submission.id, submission.byteHash);
    groups.set(key, group);

    const perContent = studentsPerContentInGroup.get(key) ?? new Map<string, Set<string>>();
    const sameFile = perContent.get(submission.contentHash ?? '') ?? new Set<string>();
    sameFile.add(submission.studentId);
    perContent.set(submission.contentHash ?? '', sameFile);
    studentsPerContentInGroup.set(key, perContent);

    if (submission.byteHash) {
      const perByte = studentsPerByteInGroup.get(key) ?? new Map<string, Set<string>>();
      const sameBytes = perByte.get(submission.byteHash) ?? new Set<string>();
      sameBytes.add(submission.studentId);
      perByte.set(submission.byteHash, sameBytes);
      studentsPerByteInGroup.set(key, perByte);
    }

    const owners = groupOwners.get(key) ?? new Set<string | null>();
    owners.add(submission.studentGroupId);
    groupOwners.set(key, owners);

    const times = submissionTimes.get(key) ?? [];
    times.push({
      studentId: submission.studentId,
      at: submission.submittedAt.getTime(),
      passedAt:
        submission.correct === true && submission.evaluatedAt
          ? submission.evaluatedAt.getTime()
          : null,
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
    group.byteIdenticalStudentCount = Math.max(
      1,
      ...[...(studentsPerByteInGroup.get(key)?.values() ?? [])].map((set) => set.size),
    );
    labelByteSets(group, byteHashes);
    reportable.push(group);
  }

  // The third check, over everything the first two left behind.
  reportable.push(
    ...(await findNearMatchGroups(assignmentId, problemIds, problems, attemptNumbers, options)),
  );

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
  assignmentId: string,
  matched: { id: string; problemId: string; studentId: string }[],
  options: FindMatchesOptions = {},
): Promise<Map<string, number>> {
  const numbers = new Map<string, number>();
  // Nothing decides anything by the attempt number: it is there so a card can say "their
  // third attempt". A caller that only wants how many matches there are skips the two reads
  // it costs, and every classification below is the same either way.
  if (matched.length === 0 || options.countOnly) return numbers;

  const attempts = await prisma.submission.findMany({
    where: {
      // Within this assignment: "their third attempt" means their third at this problem in
      // this assignment, which is the thing the reader is looking at.
      assignmentId,
      OR: [...new Set(matched.map((row) => `${row.problemId}:${row.studentId}`))].map((pair) => {
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

/**
 * Number the sets of byte-identical files inside one match, so the page can say WHICH
 * submissions were the same file rather than how many.
 *
 * Numbered per match and in the order they appear, which is all the page needs: `b1` means
 * nothing outside the group it was assigned in, and the hash it stands for never leaves the
 * server. A submission whose file was never hashed keeps a null label, because "not known"
 * and "different" are not the same answer.
 */
function labelByteSets(group: SubmissionMatchGroup, byteHashes: Map<string, string | null>): void {
  const labels = new Map<string, string>();
  for (const submission of group.submissions) {
    const hash = byteHashes.get(submission.id);
    if (!hash) continue;
    // Carrying the match's own id, so two matches cannot both call their first set `b1` and
    // have a reader of the page conclude that submissions in different matches agree. They
    // cannot: identical bytes normalise to identical contents, so byte-equal work is always
    // inside one match. The prefix makes that impossible to get wrong by accident.
    if (!labels.has(hash)) labels.set(hash, `${group.matchId}-b${labels.size + 1}`);
    submission.byteKey = labels.get(hash) ?? null;
  }
}

/** The size of the work, from the description stored with it. */
function sizeOf(features: unknown): { stateCount: number | null; transitionCount: number | null } {
  const described = features as ProvenanceFeatures | null;
  if (!described || typeof described !== 'object') {
    return { stateCount: null, transitionCount: null };
  }
  return {
    stateCount: described.stateCount ?? null,
    transitionCount: described.transitionCount ?? null,
  };
}

type TimedSubmission = {
  studentId: string;
  at: number;
  /**
   * When this attempt was marked correct, if it ever was. Null for anything not marked
   * correct, and for a correct attempt graded before the result time was recorded, where
   * "not known" is the only honest answer.
   */
  passedAt: number | null;
  contentHash: string;
};

/**
 * Did somebody submit the same work after another student's copy had ALREADY been marked
 * correct?
 *
 * Measured against when the earlier result landed, not when the earlier attempt was sent.
 * Those are different moments, and only the first one supports the sentence the page prints:
 * an evaluation takes as long as it takes, so comparing submission times would say a student
 * who submitted a minute after somebody else had "seen it pass" when the mark did not exist
 * for another four minutes. Where the result time is not known, which is every attempt graded
 * before it was recorded, this says nothing rather than assuming.
 *
 * Keyed on the contents rather than the raw bytes, and deliberately: the claim is that this
 * work had already been shown to pass, which grading decides from the contents, and a file
 * saved again by JFLAP is the same work for this purpose. Ordering alone, with no gap limit:
 * work passed along a week later is the same act as work passed along in the corridor.
 */
function wasReusedAfterPassing(times: TimedSubmission[]): boolean {
  return times.some((later) =>
    times.some(
      (earlier) =>
        earlier.passedAt !== null &&
        earlier.studentId !== later.studentId &&
        earlier.contentHash === later.contentHash &&
        earlier.passedAt < later.at,
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
  assignmentId: string,
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
  options: FindMatchesOptions = {},
): Promise<SubmissionMatchGroup[]> {
  const subject = options.subject ?? 'student';
  const rows = await prisma.submission.findMany({
    where: {
      assignmentId,
      problemId: { in: problemIds },
      provenanceFeatures: { not: Prisma.DbNull },
    },
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
      byteHash: true,
      provenanceFeatures: true,
      student: { select: studentSelect },
      studentGroup: { select: { id: true, name: true } },
    },
  });

  // The exact checks only numbered the submissions they matched, and a near match usually
  // involves different ones, so number these too rather than showing a blank where the other
  // cards show "Submission 3".
  const nearAttempts = await numberAttempts(assignmentId, rows, options);

  const groups: SubmissionMatchGroup[] = [];

  // A problem at a time: a match only means something among students answering the same
  // question, and the rarity weighting needs one cohort to count against.
  for (const problemId of problemIds) {
    const forProblem = rows.filter((row) => row.problemId === problemId);
    if (forProblem.length < 2) continue;

    const studentsInProblem = new Set(forProblem.map((row) => row.studentId)).size;
    const groupsInProblem = new Set(
      forProblem.map((row) => row.studentGroupId).filter((id): id is string => id !== null),
    ).size;

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

    for (const near of findNearMatches(inputs, { subject })) {
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
        groupCount: new Set(
          pair.map((row) => row.studentGroupId).filter((id): id is string => id !== null),
        ).size,
        problemGroupCount: groupsInProblem,
        // Neither is the other's file; that is what makes this the third check. The byte
        // count is 1 for the same reason and can never be anything else: identical bytes
        // normalise to identical contents, so byte-equal work is grouped by the first two
        // checks and never reaches this one.
        identicalStudentCount: 1,
        byteIdenticalStudentCount: 1,
        closestGapMs: Math.abs(near.a.submittedAt.getTime() - near.b.submittedAt.getTime()),
        /**
         * Never claimed for a structural match, and not because the timing is unknown.
         *
         * The badge says work was reused after another student's copy had been marked
         * correct. These two submissions are not copies of each other: that is the whole
         * definition of this third check, which reports pairs that share uncommon structure
         * WITHOUT being the same work. Whatever passed for the earlier student is not what
         * the later one submitted, so the sentence would be describing something that did
         * not happen. The chronology on the card still shows both times and both results,
         * which is the part the data actually supports.
         */
        reusedAfterPass: false,
        matchesAnswerFile: false,
        ...sizeOf(pair[0]?.provenanceFeatures),
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
            // Two near-matched files are never the same bytes (identical bytes normalise to
            // identical contents, which the first two checks would have grouped), so each
            // gets its own label and the page says nothing about raw equality here.
            byteKey: row.byteHash ? `near-${row.id}` : null,
            student: row.student,
            studentGroup: row.studentGroup,
          })),
      });
    }
  }

  return groups;
}
