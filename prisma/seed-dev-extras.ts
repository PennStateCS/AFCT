/**
 * The rest of a usable development database.
 *
 * `seed-dev.ts` creates people, courses, problems and assignments, which is where AFCT was when
 * it was written. Everything built since arrives empty: no groups, no similarity data, six
 * submissions across nine courses, an empty activity log. A developer opening the Similarity
 * report, the group gradebook or System Logs locally sees nothing at all and cannot tell a bug
 * from an empty table, which is how somebody ends up hand-writing a script to make demo data
 * before they can look at their own feature.
 *
 * So this fills in what the app grew. Each block is independent and skips itself when its table
 * already has rows, so it can top up a database somebody has been working in rather than
 * demanding a wipe.
 *
 * Three rules worth keeping:
 *
 * - **Hashes come from the app's own code.** `submissionContentHash` and friends are imported
 *   rather than reimplemented, so seeded submissions match on exactly the rules the detector
 *   uses. A seed with its own copy of that logic would drift and quietly stop demonstrating the
 *   feature it exists to demonstrate.
 * - **Seeded rows are rows the app could have written.** A submission carries a file of the
 *   right type for its problem, a group submission names its group, a grade is worth what the
 *   problem is worth, and a group set that has been submitted against is locked. Data the app
 *   cannot produce teaches a developer the wrong thing about it.
 * - **Randomness is seeded.** Two developers running this get the same database, so "it happens
 *   on my machine" means something. Override with `AFCT_SEED=<number>` when you want a different
 *   shape.
 */

import type { PrismaClient, SubmissionStatus } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { submissionContentHash, submissionShapeHash } from '@/lib/similarity/content-hash';
import { extractProvenanceFeatures } from '@/lib/similarity/provenance';

import { editOneTransition, loadSamples, ownAttempt, redraw } from './seed-answers';
import { assignmentData, courseData, groupSetData } from './seed-data';
import { seedRandom as random } from './seed-random';

const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]!;
const chance = (p: number) => random() < p;
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Where the app keeps one kind of uploaded file. Mirrors the path handling in `seed-dev.ts`:
 * the container path when there is one, otherwise a directory under the checkout.
 */
async function uploadDir(kind: 'submissions' | 'solutions' | 'pfps'): Promise<string> {
  const inContainer = path.join(path.sep, 'private', 'uploads', kind);
  try {
    await fs.mkdir(inContainer, { recursive: true });
    return inContainer;
  } catch {
    const local = path.join(process.cwd(), 'private', 'uploads', kind);
    await fs.mkdir(local, { recursive: true });
    return local;
  }
}

/**
 * Write a file and describe it the way `createSubmission` would.
 *
 * The three fields are what the Similarity report reads, and computing them here with the app's
 * own functions is what makes seeded work actually match.
 */
async function storeFile(dir: string, content: string) {
  const fileName = `${randomUUID()}.jff`;
  await fs.writeFile(path.join(dir, fileName), content, 'utf8');
  return {
    fileName,
    originalFileName: 'submission.jff',
    contentHash: submissionContentHash(content),
    shapeHash: submissionShapeHash(content),
    provenanceFeatures: (extractProvenanceFeatures(content) ?? undefined) as never,
  };
}

/**
 * What each student does with this problem.
 *
 * The first four positions are the cases the Similarity report exists to tell apart, and the
 * rest of the class is ordinary work: some of it converges on the posted answer, most of it does
 * not. The mixture matters as much as the matches, because a match only means something when it
 * is rare among the people answering the same question.
 */
type Behaviour = 'copied' | 'copied-redrawn' | 'copied-edited' | 'converged' | 'own';

function behaviourFor(index: number, cohort: number): Behaviour {
  // A group assignment has four submitters, not twenty. Seeding the same four copy behaviours
  // there would make every group in the course a copy of every other, which is not a demonstration
  // of anything: a match means something only when most of the cohort does not match.
  if (cohort < 8) return index < 2 ? 'copied' : 'own';

  if (index === 0 || index === 1) return 'copied';
  if (index === 2) return 'copied-redrawn';
  if (index === 3) return 'copied-edited';
  return chance(0.35) ? 'converged' : 'own';
}

/**
 * When a student sent this attempt.
 *
 * Anchored to the assignment's own due date rather than "some day in the last month", which used
 * to put work on an archived course months after it ended and on a course that had not started.
 * Most of the class submits in the last few days before the deadline; a few are late, which is
 * the case the late-cutoff handling exists for.
 */
function submittedAtFor(dueDate: Date, courseStart: Date, late: boolean): Date {
  const now = Date.now();
  const due = dueDate.getTime();

  // Only work that is already due can be late, and nothing can be submitted in the future.
  if (late && due < now) return new Date(Math.min(now, due + (2 + random() * 60) * HOUR_MS));

  const end = Math.min(now, due);
  const start = Math.max(courseStart.getTime(), end - 14 * DAY_MS);
  if (end <= start) return new Date(end);
  return new Date(start + random() * (end - start));
}

/**
 * Submissions, in the quantity and shape the newer screens need.
 *
 * Six submissions across nine courses left the submissions table, the autograder queue, the
 * statistics and the similarity report all looking broken rather than empty. This writes a few
 * hundred: files of the right kind for the problem, several attempts each, group work recorded
 * against its group, a queue that is not entirely finished, and deliberate similarity between
 * particular students so the report has something true to say.
 */
async function seedSubmissions(prisma: PrismaClient) {
  if ((await prisma.submission.count()) > 10) {
    console.log('[seed] extras: submissions already present, skipping');
    return;
  }

  const dir = await uploadDir('submissions');
  const samples = await loadSamples();
  if (samples.size === 0) {
    console.warn('[seed] extras: no .jff samples to submit; skipping submissions');
    return;
  }

  const links = await prisma.assignmentProblem.findMany({
    select: {
      assignmentId: true,
      problemId: true,
      problem: { select: { type: true, originalFileName: true } },
      assignment: {
        select: {
          courseId: true,
          dueDate: true,
          isPublished: true,
          allowLateSubmissions: true,
          groupSetId: true,
          course: { select: { startDate: true } },
          // Who the assignment is set for. Empty means the whole class, which is the usual case.
          assignees: { select: { userId: true, targetType: true } },
        },
      },
    },
    // Every query the seed walks is ordered, because the order rows come back in decides which
    // random number each one draws. Without this the seed is only reproducible for as long as
    // Postgres happens to return rows in insertion order, which it does not promise.
    orderBy: [{ assignmentId: 'asc' }, { problemId: 'asc' }],
  });

  type Row = {
    assignmentId: string;
    problemId: string;
    courseId: string;
    studentId: string;
    studentGroupId: string | null;
    status: SubmissionStatus;
    correct: boolean | null;
    attempts: number;
    submittedAt: Date;
    feedback: string | null;
    fileName: string;
    originalFileName: string;
    contentHash: string | null;
    shapeHash: string | null;
    provenanceFeatures: never;
  };
  const rows: Row[] = [];

  for (const link of links) {
    // An unpublished assignment is one no student can see, so work against it could not exist.
    if (!link.assignment.isPublished) continue;
    // Nor could work on a course that has not started.
    if (link.assignment.course.startDate.getTime() > Date.now()) continue;

    // The answer this problem was set for. Falling back to any sample of the right type keeps a
    // problem whose solution file went missing from being answered with the wrong kind of file.
    const forType = samples.get(link.problem.type ?? 'FA');
    if (!forType || forType.size === 0) continue;
    const canonical =
      (link.problem.originalFileName ? forType.get(link.problem.originalFileName) : undefined) ??
      [...forType.values()][0]!;

    // Who submits: on a group assignment the group does, through one of its members, and one
    // submission counts for everybody in it.
    const groups = link.assignment.groupSetId
      ? await prisma.studentGroup.findMany({
          where: { groupSetId: link.assignment.groupSetId },
          select: {
            id: true,
            memberships: { select: { userId: true }, orderBy: { userId: 'asc' } },
          },
          orderBy: { name: 'asc' },
        })
      : [];

    // Only the students the assignment is actually set for. Anybody else has no route to
    // submitting to it, so seeding their work would be seeding something impossible.
    const audience = new Set(
      link.assignment.assignees
        .filter((assignee) => assignee.targetType === 'STUDENT' && assignee.userId)
        .map((assignee) => assignee.userId as string),
    );

    const submitters = link.assignment.groupSetId
      ? groups
          .filter((group) => group.memberships.length > 0)
          .map((group) => ({
            userId: pick(group.memberships).userId,
            studentGroupId: group.id as string | null,
          }))
      : (
          await prisma.roster.findMany({
            where: { courseId: link.assignment.courseId, role: 'STUDENT' },
            select: { userId: true },
            orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
          })
        )
          .filter((roster) => audience.size === 0 || audience.has(roster.userId))
          .map((roster) => ({ userId: roster.userId, studentGroupId: null }));

    for (const [index, submitter] of submitters.entries()) {
      const behaviour = behaviourFor(index, submitters.length);
      const attempts = 1 + (chance(0.4) ? 1 : 0) + (chance(0.15) ? 1 : 0);
      const late = chance(0.08);
      // Attempts are timed backwards from the last one, so a student's second try never predates
      // their first. Ordering is the whole point of an attempt list.
      const finalAt = submittedAtFor(
        link.assignment.dueDate,
        link.assignment.course.startDate,
        late && link.assignment.allowLateSubmissions,
      );

      for (let attempt = 1; attempt <= attempts; attempt++) {
        const isFinal = attempt === attempts;
        // A last attempt is usually right; the ones before it usually are not. That is what makes
        // the attempt counts and the "best attempt" logic worth looking at.
        const correct = isFinal ? chance(0.75) : chance(0.15);

        // One number per student per attempt, so no two people's own working comes out as the
        // same file by arithmetic rather than by copying.
        const variant = index * 5 + attempt;

        // Earlier attempts are the student's own working, whoever they turn out to be: somebody
        // copying a file does it once, at the end, not three times.
        let content: string;
        if (!isFinal || behaviour === 'own') {
          content = ownAttempt(canonical, variant);
        } else if (behaviour === 'copied') {
          content = canonical;
        } else if (behaviour === 'copied-redrawn') {
          content = redraw(canonical, 1);
        } else if (behaviour === 'copied-edited') {
          content = editOneTransition(canonical);
        } else {
          // Converged: the right answer, drawn their own way. Common, and the reason a match is
          // read against how rare it is rather than on its own.
          content = correct ? redraw(canonical, 2 + index) : ownAttempt(canonical, variant);
        }

        const submittedAt = new Date(
          Math.max(
            link.assignment.course.startDate.getTime(),
            finalAt.getTime() - (attempts - attempt) * (30 + random() * 300) * 60 * 1000,
          ),
        );

        // Everything here has already been through the grader. Work still waiting in the queue is
        // seeded last, by `seedQueue`, for a reason worth knowing: the dev worker is running, so
        // a PENDING row written now is claimed and graded within a second or two, and the grades
        // and log entries it writes made the later steps think they had already run.
        const status: SubmissionStatus = chance(0.03) ? 'FAILED' : 'COMPLETED';

        const stored = await storeFile(dir, content);
        rows.push({
          assignmentId: link.assignmentId,
          problemId: link.problemId,
          courseId: link.assignment.courseId,
          studentId: submitter.userId,
          studentGroupId: submitter.studentGroupId,
          status,
          // A failed attempt never got a verdict.
          correct: status === 'FAILED' ? null : correct,
          // How many times the *worker* has claimed it, which is not the student's attempt
          // number: one claim to grade it, and a failure is what a retried claim ends in.
          attempts: status === 'FAILED' ? 3 : 1,
          submittedAt,
          feedback:
            status === 'FAILED'
              ? 'The grader did not return a verdict for this attempt.'
              : correct
                ? 'Accepted every string in the test set.'
                : 'Rejected 0110, which the language contains.',
          ...stored,
        });
      }
    }
  }

  // In batches: a few hundred round trips is the difference between a seed a new developer waits
  // through and one they assume has hung.
  for (let i = 0; i < rows.length; i += 200) {
    await prisma.submission.createMany({ data: rows.slice(i, i + 200) });
  }
  console.log(`[seed] extras: created ${rows.length} submissions with similarity data`);
}

/**
 * Work that has been sent and not yet graded.
 *
 * Runs last, and everything it writes is deliberately fresh. Without it the Autograder page, the
 * status filters and the queue depth on System Status are only ever reviewable against a table
 * where every row already finished, which is the one state they are least likely to be wrong in.
 *
 * With `npm run docker:dev` up, the worker will claim these within seconds and grade them for
 * real, against the same evaluator a submission from the browser goes through. That is the point
 * of seeding a file of the right type for the problem: this work can actually be graded.
 */
async function seedQueue(prisma: PrismaClient) {
  if (
    (await prisma.submission.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } })) > 0
  ) {
    console.log('[seed] extras: work already waiting in the queue, skipping');
    return;
  }

  const dir = await uploadDir('submissions');
  const samples = await loadSamples();
  const links = await prisma.assignmentProblem.findMany({
    where: {
      autograderEnabled: true,
      assignment: { isPublished: true, course: { startDate: { lte: new Date() } } },
    },
    select: {
      assignmentId: true,
      problemId: true,
      problem: { select: { type: true, originalFileName: true } },
      assignment: { select: { courseId: true, groupSetId: true } },
    },
    orderBy: [{ assignmentId: 'asc' }, { problemId: 'asc' }],
    take: 6,
  });

  let queued = 0;
  for (const link of links) {
    // Individual work only: a group submission locks its set and counts for every member, which
    // is a lot of consequence for a row that exists to make the queue non-empty.
    if (link.assignment.groupSetId) continue;

    const forType = samples.get(link.problem.type ?? 'FA');
    const canonical =
      (link.problem.originalFileName ? forType?.get(link.problem.originalFileName) : undefined) ??
      (forType ? [...forType.values()][0] : undefined);
    if (!canonical) continue;

    const students = await prisma.roster.findMany({
      where: { courseId: link.assignment.courseId, role: 'STUDENT' },
      select: { userId: true },
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
      take: 2,
    });

    for (const [index, student] of students.entries()) {
      const stored = await storeFile(dir, ownAttempt(canonical, queued + 1));
      await prisma.submission.create({
        data: {
          assignmentId: link.assignmentId,
          problemId: link.problemId,
          courseId: link.assignment.courseId,
          studentId: student.userId,
          // Nothing has judged it yet, and nothing has claimed a pending row.
          status: index === 0 ? 'PENDING' : 'PROCESSING',
          correct: null,
          attempts: index === 0 ? 0 : 1,
          submittedAt: new Date(Date.now() - (2 + queued * 3) * 60 * 1000),
          feedback: null,
          ...stored,
        },
      });
      queued += 1;
    }
  }
  console.log(`[seed] extras: left ${queued} submissions waiting in the autograder queue`);
}

/**
 * Groups, which group assignments and group grading are built on and which nothing seeded.
 *
 * The sets come from `seed-data`, next to the assignments that use them, because which
 * assignments are group work is a fact about the course rather than something to discover here.
 */
async function seedGroups(prisma: PrismaClient) {
  if ((await prisma.groupSet.count()) > 0) {
    console.log('[seed] extras: group sets already present, skipping');
    return;
  }

  const setIdsByCourseAndName = new Map<string, string>();
  let groupsCreated = 0;

  for (const setSeed of groupSetData) {
    const regCode = courseData[setSeed.courseIndex]?.regCode;
    const course = regCode ? await prisma.course.findUnique({ where: { regCode } }) : null;
    if (!course) continue;

    const students = await prisma.roster.findMany({
      where: { courseId: course.id, role: 'STUDENT' },
      select: { userId: true },
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
    });
    if (students.length < 4) continue;

    const set = await prisma.groupSet.create({
      data: { name: setSeed.name, courseId: course.id },
      select: { id: true },
    });
    setIdsByCourseAndName.set(`${course.id}:${setSeed.name}`, set.id);

    let index = 0;
    for (const [n, size] of setSeed.sizes.entries()) {
      const members = students.slice(index, index + size);
      index += size;
      if (members.length === 0) break;

      const group = await prisma.studentGroup.create({
        data: { name: `Team ${n + 1}`, groupSetId: set.id },
        select: { id: true },
      });
      await prisma.groupMembership.createMany({
        data: members.map((member) => ({
          groupSetId: set.id,
          groupId: group.id,
          courseId: course.id,
          userId: member.userId,
        })),
      });
      groupsCreated += 1;
    }
  }

  // Individual versus group is the single fact `groupSetId` carries, so this is what makes an
  // assignment a group assignment. Most stay individual, which is the ordinary case.
  let groupAssignments = 0;
  for (const [courseIndex, courseSeed] of courseData.entries()) {
    const course = await prisma.course.findUnique({ where: { regCode: courseSeed.regCode } });
    if (!course) continue;

    for (const assignmentSeed of assignmentData) {
      if (assignmentSeed.courseIndex !== courseIndex || !assignmentSeed.groupSet) continue;
      const groupSetId = setIdsByCourseAndName.get(`${course.id}:${assignmentSeed.groupSet}`);
      if (!groupSetId) continue;

      const assignment = await prisma.assignment.findFirst({
        where: { courseId: course.id, title: assignmentSeed.title },
        select: { id: true },
      });
      if (!assignment) continue;

      await prisma.assignment.update({ where: { id: assignment.id }, data: { groupSetId } });
      // A set that has been submitted against is locked against membership edits, and the seed
      // is about to submit against it. Leaving it unlocked would be a state the app cannot
      // reach, and the group editing screens would behave differently here than anywhere else.
      await prisma.groupSet.updateMany({
        where: { id: groupSetId, lockedAt: null },
        data: { lockedAt: daysAgo(20) },
      });
      groupAssignments += 1;
    }
  }

  console.log(
    `[seed] extras: created ${groupsCreated} groups across ${setIdsByCourseAndName.size} sets, ` +
      `used by ${groupAssignments} group assignments`,
  );
}

/**
 * Grades, written the way the grader writes them.
 *
 * Two distinctions get confused constantly and both are seeded rather than described. A grade's
 * origin (the autograder or a person) and whether it is held back are different fields, so there
 * is one grade of each kind. And a group's grade is one row per member carrying which group it
 * came from, not a single row against the group, which is what the "adjusted from" marker on a
 * member later changed by hand is read from.
 */
async function seedGrades(prisma: PrismaClient) {
  if ((await prisma.assignmentProblemGrade.count()) > 0) {
    console.log('[seed] extras: grades already present, skipping');
    return;
  }

  // Only finished work is graded, and only where the autograder is meant to run: a problem set
  // for hand grading gets the grades below instead.
  const graded = await prisma.submission.findMany({
    where: { status: 'COMPLETED', correct: { not: null } },
    select: {
      assignmentId: true,
      problemId: true,
      studentId: true,
      studentGroupId: true,
      correct: true,
      feedback: true,
      assignmentProblem: { select: { maxPoints: true, autograderEnabled: true } },
    },
    orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
  });

  type GradeRow = {
    assignmentId: string;
    problemId: string;
    studentId: string;
    grade: number;
    feedback: string | null;
    gradedManually: boolean;
    gradeSource: 'AUTOGRADER' | 'MANUAL';
    groupGradeGroupId?: string | null;
    groupGradeValue?: number | null;
  };
  // Newest wins, the same as re-grading: iterating oldest-first and overwriting leaves one row
  // per student per problem holding their latest verdict.
  const byTarget = new Map<string, GradeRow>();
  const memberCache = new Map<string, string[]>();

  for (const submission of graded) {
    if (!submission.assignmentProblem.autograderEnabled) continue;
    const earned = submission.correct ? submission.assignmentProblem.maxPoints : 0;

    let targets = [submission.studentId];
    if (submission.studentGroupId) {
      const cached = memberCache.get(submission.studentGroupId);
      targets =
        cached ??
        (
          await prisma.groupMembership.findMany({
            where: { groupId: submission.studentGroupId },
            select: { userId: true },
            orderBy: { userId: 'asc' },
          })
        ).map((membership) => membership.userId);
      memberCache.set(submission.studentGroupId, targets);
    }

    for (const studentId of targets) {
      byTarget.set(`${submission.assignmentId}:${submission.problemId}:${studentId}`, {
        assignmentId: submission.assignmentId,
        problemId: submission.problemId,
        studentId,
        grade: earned,
        feedback: submission.feedback,
        gradedManually: false,
        gradeSource: 'AUTOGRADER',
        groupGradeGroupId: submission.studentGroupId,
        groupGradeValue: submission.studentGroupId ? earned : null,
      });
    }
  }

  // A few grades a person set: partial credit the autograder cannot award, held against
  // re-grading. One of them is a member of a group pulled off the group's grade, which is the
  // case the "adjusted from" marker is for.
  const rows = [...byTarget.values()];
  let manual = 0;
  for (const [index, row] of rows.entries()) {
    if (index % 23 !== 0 || row.grade === 0) continue;
    row.grade = Math.round(row.grade * 0.7);
    row.gradedManually = true;
    row.gradeSource = 'MANUAL';
    row.feedback = 'Partial credit for the construction, marked by hand.';
    manual += 1;
  }

  // Hand-graded work: a problem with the autograder off has no grade until somebody enters one,
  // so this is the only way those rows exist at all.
  const handGraded = await prisma.assignmentProblem.findMany({
    // Published only. A draft is one no student can see, so a grade against it is a grade for
    // work nobody could have done.
    where: { autograderEnabled: false, assignment: { isPublished: true } },
    select: {
      assignmentId: true,
      problemId: true,
      maxPoints: true,
      assignment: { select: { courseId: true } },
    },
    orderBy: [{ assignmentId: 'asc' }, { problemId: 'asc' }],
  });
  for (const link of handGraded) {
    const students = await prisma.roster.findMany({
      where: { courseId: link.assignment.courseId, role: 'STUDENT' },
      select: { userId: true },
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
      take: 6,
    });
    for (const student of students) {
      rows.push({
        assignmentId: link.assignmentId,
        problemId: link.problemId,
        studentId: student.userId,
        grade: Math.round(link.maxPoints * (0.6 + random() * 0.4)),
        feedback: 'Marked from the written reduction.',
        gradedManually: true,
        gradeSource: 'MANUAL',
      });
      manual += 1;
    }
  }

  for (let i = 0; i < rows.length; i += 200) {
    await prisma.assignmentProblemGrade.createMany({ data: rows.slice(i, i + 200) });
  }
  console.log(`[seed] extras: created ${rows.length} grades (${manual} entered by hand)`);
}

/** Feedback threads, so the comment surfaces are not blank. */
async function seedComments(prisma: PrismaClient) {
  if ((await prisma.comment.count()) > 0) {
    console.log('[seed] extras: comments already present, skipping');
    return;
  }

  const links = await prisma.assignmentProblem.findMany({
    select: { assignmentId: true, problemId: true, assignment: { select: { courseId: true } } },
    orderBy: [{ assignmentId: 'asc' }, { problemId: 'asc' }],
    take: 6,
  });

  let written = 0;
  for (const link of links) {
    const staff = await prisma.roster.findFirst({
      where: { courseId: link.assignment.courseId, role: { in: ['FACULTY', 'TA'] } },
      select: { userId: true, id: true },
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
    });
    const student = await prisma.roster.findFirst({
      where: { courseId: link.assignment.courseId, role: 'STUDENT' },
      select: { userId: true },
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
    });
    if (!staff || !student) continue;

    await prisma.comment.create({
      data: {
        content: 'Your start state accepts the empty string; check the first transition.',
        assignmentId: link.assignmentId,
        problemId: link.problemId,
        authorId: staff.userId,
        rosterId: staff.id,
        aboutStudentId: student.userId,
      },
    });
    written += 1;
  }
  console.log(`[seed] extras: created ${written} comments`);
}

/** Extra attempts granted to particular people, which the submission-limit resolver reads. */
async function seedGrants(prisma: PrismaClient) {
  if ((await prisma.submissionGrant.count()) > 0) {
    console.log('[seed] extras: grants already present, skipping');
    return;
  }

  // Only a problem with a cap can be granted more attempts, so pick one that has one.
  const link = await prisma.assignmentProblem.findFirst({
    where: { maxSubmissions: { gt: 0 } },
    select: { assignmentId: true, problemId: true, assignment: { select: { courseId: true } } },
    orderBy: [{ assignmentId: 'asc' }, { problemId: 'asc' }],
  });
  if (!link) return;

  const student = await prisma.roster.findFirst({
    where: { courseId: link.assignment.courseId, role: 'STUDENT' },
    select: { userId: true },
    orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
  });
  const staff = await prisma.roster.findFirst({
    where: { courseId: link.assignment.courseId, role: 'FACULTY' },
    select: { userId: true },
    orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
  });
  if (!student) return;

  await prisma.submissionGrant.create({
    data: {
      targetType: 'STUDENT',
      assignmentId: link.assignmentId,
      problemId: link.problemId,
      userId: student.userId,
      extraSubmissions: 2,
      reason: 'Lost two attempts to a network drop.',
      createdById: staff?.userId ?? null,
    },
  });
  console.log('[seed] extras: created 1 submission grant');
}

/**
 * A targeted assignment and a date override.
 *
 * Audience and dates are separate concepts and are confused constantly: an assignment is
 * targeted through AssignmentAssignee, while AssignmentOverride only ever changes dates. Seeding
 * one of each keeps that visible.
 *
 * Runs *before* the submissions step, and the assignment it narrows is one declared for the
 * purpose in `seed-data`. Both matter. Narrowing whichever assignment happened to come back
 * first left forty-five submissions in the database from students the assignment was not
 * assigned to, which the app has no route to produce and which makes the audience rules look
 * like they do not apply.
 */
async function seedAudienceAndOverrides(prisma: PrismaClient) {
  if ((await prisma.assignmentAssignee.count()) > 0) {
    console.log('[seed] extras: assignment audiences already present, skipping');
    return;
  }

  let targeted = 0;
  for (const [courseIndex, courseSeed] of courseData.entries()) {
    for (const assignmentSeed of assignmentData) {
      if (assignmentSeed.courseIndex !== courseIndex || !assignmentSeed.targetedStudents) continue;

      const course = await prisma.course.findUnique({ where: { regCode: courseSeed.regCode } });
      if (!course) continue;
      const assignment = await prisma.assignment.findFirst({
        where: { courseId: course.id, title: assignmentSeed.title },
        select: { id: true },
      });
      if (!assignment) continue;

      const students = await prisma.roster.findMany({
        where: { courseId: course.id, role: 'STUDENT' },
        select: { userId: true },
        orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
        take: assignmentSeed.targetedStudents,
      });
      if (students.length === 0) continue;

      await prisma.assignmentAssignee.createMany({
        data: students.map((student) => ({
          targetType: 'STUDENT' as const,
          assignmentId: assignment.id,
          userId: student.userId,
        })),
      });

      // A date change, not an audience change: the two are different rows for a reason.
      await prisma.assignmentOverride.create({
        data: {
          targetType: 'STUDENT',
          assignmentId: assignment.id,
          userId: students[0]!.userId,
          dueDate: new Date(Date.now() + 7 * DAY_MS),
          allowLateSubmissions: true,
        },
      });
      targeted += students.length;
    }
  }

  console.log(
    `[seed] extras: targeted one assignment at ${targeted} students, with 1 date override`,
  );
}

/**
 * Activity log entries, so the log viewer has something to show.
 *
 * Spread across severities and actions on purpose: the page's filters, its severity colours and
 * the entry-detail formatting are all unreviewable against an empty table, and this log is
 * research data as well as an audit trail, so seeing what it records matters.
 */
async function seedActivityLog(prisma: PrismaClient) {
  if ((await prisma.activityLog.count()) > 0) {
    console.log('[seed] extras: activity log already has entries, skipping');
    return;
  }

  const users = await prisma.user.findMany({
    select: { id: true },
    orderBy: { email: 'asc' },
    take: 8,
  });
  const course = await prisma.course.findFirst({
    select: { id: true },
    orderBy: { regCode: 'asc' },
  });
  if (users.length === 0) return;

  const kinds: Array<{
    action: string;
    severity: 'INFO' | 'WARNING' | 'ERROR' | 'SECURITY';
    category: string;
    metadata?: object;
  }> = [
    { action: 'LOGIN', severity: 'INFO', category: 'USER' },
    {
      action: 'LOGIN_FAILED',
      severity: 'SECURITY',
      category: 'USER',
      metadata: { reason: 'invalid password' },
    },
    {
      action: 'SUBMISSION_CREATED',
      severity: 'INFO',
      category: 'SUBMISSION',
      metadata: { attempt: 2 },
    },
    {
      action: 'GRADE_CHANGED',
      severity: 'INFO',
      category: 'SUBMISSION',
      metadata: { from: 40, to: 85, by: 'hand' },
    },
    { action: 'COURSE_UPDATED', severity: 'INFO', category: 'COURSE' },
    {
      action: 'BACKUP_FAILED',
      severity: 'ERROR',
      category: 'SYSTEM',
      metadata: { reason: 'no space left on device' },
    },
    {
      action: 'ROSTER_IMPORTED',
      severity: 'WARNING',
      category: 'COURSE',
      metadata: { skipped: 3, reason: 'no matching email' },
    },
  ];

  for (let i = 0; i < 60; i++) {
    const kind = kinds[i % kinds.length]!;
    await prisma.activityLog.create({
      data: {
        userId: pick(users).id,
        action: kind.action,
        severity: kind.severity,
        category: kind.category,
        courseId: course?.id ?? null,
        timestamp: daysAgo(random() * 20),
        metadata: (kind.metadata ?? undefined) as never,
        ipAddress: `192.0.2.${1 + Math.floor(random() * 250)}`,
      },
    });
  }
  console.log('[seed] extras: created 60 activity log entries');
}

/**
 * Delete uploaded files no row points at any more.
 *
 * Every seeded submission writes a file, so a developer who re-seeds a few times accumulates
 * them: on this machine the dev volume held 6,335 submission files, 416 avatars and 173 solution
 * files against a database of 538 submissions, 32 users and 117 problems. Nothing ever removed
 * them, because dropping the schema does not touch the disk.
 *
 * A file is deleted only when its own table no longer names it, so anything a developer uploaded
 * through the app survives as long as its row does. Files written after this run began are left
 * alone as well, because `createSubmission` writes the file before it writes the row and a real
 * upload landing mid-run would otherwise look like an orphan for a moment.
 *
 * `startedAt` is the moment the seed began, deliberately, and not "a minute ago": with a
 * wall-clock window, re-seeding twice inside that window protected the previous run's garbage,
 * so the directory doubled instead of being cleaned. Anything written before this run started is
 * either referenced or left over, and neither case needs protecting.
 */
async function pruneOrphanedUploads(prisma: PrismaClient, startedAt: number) {
  const kinds = [
    {
      kind: 'submissions' as const,
      referenced: async () =>
        (await prisma.submission.findMany({ select: { fileName: true } })).map((r) => r.fileName),
    },
    {
      kind: 'solutions' as const,
      referenced: async () =>
        (await prisma.problem.findMany({ select: { fileName: true } })).map((r) => r.fileName),
    },
    {
      kind: 'pfps' as const,
      referenced: async () =>
        (await prisma.user.findMany({ select: { avatar: true } })).map((r) => r.avatar),
    },
  ];

  let removed = 0;
  for (const { kind, referenced } of kinds) {
    const dir = await uploadDir(kind);
    const keep = new Set((await referenced()).filter((name): name is string => Boolean(name)));

    for (const name of await fs.readdir(dir)) {
      if (keep.has(name)) continue;
      const full = path.join(dir, name);
      const stat = await fs.stat(full);
      if (!stat.isFile() || stat.mtimeMs >= startedAt) continue;
      await fs.unlink(full);
      removed += 1;
    }
  }

  if (removed > 0) console.log(`[seed] extras: deleted ${removed} uploaded files no row points at`);
}

/**
 * Everything above, in dependency order: groups before the submissions that belong to one,
 * submissions before the grades and comments that refer to work, and the autograder queue last
 * of all, because the dev worker starts on it immediately and writes grades and log entries of
 * its own that would make the steps in between think they had already run.
 */
export const runDevelopmentExtras = async (prisma: PrismaClient) => {
  console.log('[seed] extras: filling in the features seeded data was missing');
  const startedAt = Date.now();
  await seedGroups(prisma);
  // Before the submissions, so work is only ever seeded for students the assignment is set for.
  await seedAudienceAndOverrides(prisma);
  await seedSubmissions(prisma);
  await seedGrades(prisma);
  await seedComments(prisma);
  await seedGrants(prisma);
  await seedActivityLog(prisma);
  await seedQueue(prisma);
  await pruneOrphanedUploads(prisma, startedAt);
};
