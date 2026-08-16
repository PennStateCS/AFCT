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
 * Two rules worth keeping:
 *
 * - **Hashes come from the app's own code.** `submissionContentHash` and friends are imported
 *   rather than reimplemented, so seeded submissions match on exactly the rules the detector
 *   uses. A seed with its own copy of that logic would drift and quietly stop demonstrating the
 *   feature it exists to demonstrate.
 * - **Randomness is seeded.** Two developers running this get the same database, so "it happens
 *   on my machine" means something. Override with `AFCT_SEED=<number>` when you want a different
 *   shape.
 */

import type { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { submissionContentHash, submissionShapeHash } from '@/lib/similarity/content-hash';
import { extractProvenanceFeatures } from '@/lib/similarity/provenance';

import { seedRandom as random } from './seed-random';

const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]!;
const chance = (p: number) => random() < p;
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const minutesAfter = (d: Date, m: number) => new Date(d.getTime() + m * 60 * 1000);

/** Where the app expects submitted files. Mirrors the path handling in `seed-dev.ts`. */
async function uploadsDir(): Promise<string> {
  const inContainer = path.join(path.sep, 'private', 'uploads', 'submissions');
  try {
    await fs.mkdir(inContainer, { recursive: true });
    return inContainer;
  } catch {
    const local = path.join(process.cwd(), 'private', 'uploads', 'submissions');
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
 * Variations on one automaton, which is what the three similarity checks are built to tell apart.
 *
 * `identical` is the same saved artifact; `redrawn` is the same machine with the states moved and
 * renamed, which only the shape hash catches; `edited` is a copy with a transition changed, which
 * only the provenance features catch. A developer can see all three kinds of match without
 * building any of it by hand.
 */
function variants(base: string) {
  const redrawn = base
    .replace(/<x>([\d.]+)<\/x>/g, (_, x) => `<x>${Number(x) + 37}</x>`)
    .replace(/<y>([\d.]+)<\/y>/g, (_, y) => `<y>${Number(y) + 21}</y>`)
    .replace(/<block id="(\d+)" name="([^"]*)">/g, '<block id="$1" name="s$1">');
  // One transition's read symbol changed: still recognisably the same work, no longer the same
  // machine.
  const edited = base.replace(/<read>([^<]*)<\/read>/, (m, sym) =>
    sym === '1' ? '<read>0</read>' : '<read>1</read>',
  );
  return { redrawn, edited };
}

/**
 * Submissions, in the quantity and shape the newer screens need.
 *
 * Six submissions across nine courses left the submissions table, the autograder queue, the
 * statistics and the similarity report all looking broken rather than empty. This writes a few
 * hundred, with real files behind them, verdicts, several attempts per student, and deliberate
 * similarity between particular students so the report has something true to say.
 */
async function seedSubmissions(prisma: PrismaClient) {
  if ((await prisma.submission.count()) > 10) {
    console.log('[seed] extras: submissions already present, skipping');
    return;
  }

  const dir = await uploadsDir();
  const sourceDir = path.join(process.cwd(), 'prisma', 'solution_files');
  const files = (await fs.readdir(sourceDir)).filter((f) => f.endsWith('.jff'));
  const samples = await Promise.all(
    files.map(async (f) => fs.readFile(path.join(sourceDir, f), 'utf8')),
  );
  if (samples.length === 0) {
    console.warn('[seed] extras: no .jff samples to submit; skipping submissions');
    return;
  }

  const links = await prisma.assignmentProblem.findMany({
    select: { assignmentId: true, problemId: true, assignment: { select: { courseId: true } } },
  });
  let written = 0;

  for (const link of links) {
    const students = await prisma.roster.findMany({
      where: { courseId: link.assignment.courseId, role: 'STUDENT' },
      select: { userId: true },
      take: 12,
    });
    if (students.length === 0) continue;

    const base = pick(samples);
    const { redrawn, edited } = variants(base);
    // Everyone else answers with something of their own, so the matches below stand out the way
    // they would in a real class rather than being lost in noise.
    const perStudent = students.map((s, i) => {
      if (i === 0 || i === 1) return base; // the same saved artifact
      if (i === 2) return redrawn; // same machine, moved and renamed
      if (i === 3) return edited; // a copy with one transition changed
      return pick(samples);
    });

    for (const [i, student] of students.entries()) {
      const attempts = 1 + (chance(0.35) ? 1 : 0) + (chance(0.15) ? 1 : 0);
      const first = daysAgo(2 + Math.floor(random() * 25));

      for (let attempt = 1; attempt <= attempts; attempt++) {
        const correct = attempt === attempts ? chance(0.7) : chance(0.2);
        const stored = await storeFile(dir, perStudent[i]!);
        await prisma.submission.create({
          data: {
            assignmentId: link.assignmentId,
            problemId: link.problemId,
            courseId: link.assignment.courseId,
            studentId: student.userId,
            status: 'COMPLETED',
            correct,
            attempts: attempt,
            submittedAt: minutesAfter(first, (attempt - 1) * (20 + Math.floor(random() * 400))),
            feedback: correct
              ? 'Accepted every string in the test set.'
              : 'Rejected 0110, which the language contains.',
            ...stored,
          },
        });
        written += 1;
      }
    }
  }
  console.log(`[seed] extras: created ${written} submissions with similarity data`);
}

/**
 * Groups, which group assignments and group grading are built on and which nothing seeded.
 *
 * One course gets a set of small groups covering its students. Sized deliberately unevenly,
 * because a set where every group has exactly three people hides the arithmetic mistakes.
 */
async function seedGroups(prisma: PrismaClient) {
  if ((await prisma.groupSet.count()) > 0) {
    console.log('[seed] extras: group sets already present, skipping');
    return;
  }

  const course = await prisma.course.findFirst({
    where: { deletedAt: null, roster: { some: { role: 'STUDENT' } } },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!course) return;

  const students = await prisma.roster.findMany({
    where: { courseId: course.id, role: 'STUDENT' },
    select: { id: true, userId: true },
  });
  if (students.length < 4) return;

  const set = await prisma.groupSet.create({
    data: { name: 'Project teams', courseId: course.id },
    select: { id: true },
  });

  // Uneven on purpose: a set where every group has the same size hides the arithmetic mistakes.
  // Trimmed to what the roster can actually fill, so a small course still gets whole groups
  // rather than an empty third one.
  const sizes = [3, 2, 4].filter((_, i, all) => {
    const needed = all.slice(0, i + 1).reduce((sum, n) => sum + n, 0);
    return needed <= students.length;
  });
  let index = 0;
  let created = 0;
  for (const [n, size] of sizes.entries()) {
    const members = students.slice(index, index + size);
    index += size;
    if (members.length === 0) break;

    const group = await prisma.studentGroup.create({
      data: { name: `Team ${n + 1}`, groupSetId: set.id },
      select: { id: true },
    });
    for (const member of members) {
      await prisma.groupMembership.create({
        data: {
          groupSetId: set.id,
          groupId: group.id,
          courseId: course.id,
          userId: member.userId,
        },
      });
    }
    created += 1;
  }

  // An assignment that is actually a group assignment: the flag is the presence of a group set,
  // so an assignment without one behaves individually however the UI is configured.
  const assignment = await prisma.assignment.findFirst({
    where: { courseId: course.id },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (assignment) {
    await prisma.assignment.update({
      where: { id: assignment.id },
      data: { groupSetId: set.id },
    });
  }
  console.log(`[seed] extras: created a group set with ${created} groups in ${course.name}`);
}

/**
 * Grades, including a manually-changed one.
 *
 * The distinction that keeps being got wrong is that a grade's origin (autograder or a person)
 * and whether it is held back are two different things, so the seed contains one of each rather
 * than a uniform set that makes them look like the same field.
 */
async function seedGrades(prisma: PrismaClient) {
  if ((await prisma.assignmentProblemGrade.count()) > 0) {
    console.log('[seed] extras: grades already present, skipping');
    return;
  }

  const graded = await prisma.submission.findMany({
    where: { correct: { not: null } },
    select: { assignmentId: true, problemId: true, studentId: true, correct: true },
    distinct: ['assignmentId', 'problemId', 'studentId'],
    take: 120,
  });

  let manual = 0;
  for (const [i, s] of graded.entries()) {
    const byHand = i % 17 === 0;
    if (byHand) manual += 1;
    await prisma.assignmentProblemGrade.create({
      data: {
        assignmentId: s.assignmentId,
        problemId: s.problemId,
        studentId: s.studentId,
        grade: byHand ? 85 : s.correct ? 100 : 40,
        gradedManually: byHand,
        gradeSource: byHand ? 'MANUAL' : 'AUTOGRADER',
        feedback: byHand ? 'Partial credit for the construction, marked by hand.' : null,
      },
    });
  }
  console.log(`[seed] extras: created ${graded.length} grades (${manual} entered by hand)`);
}

/** Feedback threads, so the comment surfaces are not blank. */
async function seedComments(prisma: PrismaClient) {
  if ((await prisma.comment.count()) > 0) {
    console.log('[seed] extras: comments already present, skipping');
    return;
  }

  const links = await prisma.assignmentProblem.findMany({
    select: { assignmentId: true, problemId: true, assignment: { select: { courseId: true } } },
    take: 6,
  });

  let written = 0;
  for (const link of links) {
    const staff = await prisma.roster.findFirst({
      where: { courseId: link.assignment.courseId, role: { in: ['FACULTY', 'TA'] } },
      select: { userId: true, id: true },
    });
    const student = await prisma.roster.findFirst({
      where: { courseId: link.assignment.courseId, role: 'STUDENT' },
      select: { userId: true },
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

  const link = await prisma.assignmentProblem.findFirst({
    select: { assignmentId: true, problemId: true, assignment: { select: { courseId: true } } },
  });
  if (!link) return;

  const student = await prisma.roster.findFirst({
    where: { courseId: link.assignment.courseId, role: 'STUDENT' },
    select: { userId: true },
  });
  const staff = await prisma.roster.findFirst({
    where: { courseId: link.assignment.courseId, role: 'FACULTY' },
    select: { userId: true },
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
 */
async function seedAudienceAndOverrides(prisma: PrismaClient) {
  if ((await prisma.assignmentAssignee.count()) > 0) {
    console.log('[seed] extras: assignment audiences already present, skipping');
    return;
  }

  const assignment = await prisma.assignment.findFirst({
    where: { groupSetId: null },
    select: { id: true, courseId: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!assignment) return;

  const students = await prisma.roster.findMany({
    where: { courseId: assignment.courseId, role: 'STUDENT' },
    select: { userId: true },
    take: 3,
  });
  if (students.length === 0) return;

  for (const student of students) {
    await prisma.assignmentAssignee.create({
      data: { targetType: 'STUDENT', assignmentId: assignment.id, userId: student.userId },
    });
  }

  await prisma.assignmentOverride.create({
    data: {
      targetType: 'STUDENT',
      assignmentId: assignment.id,
      userId: students[0]!.userId,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      allowLateSubmissions: true,
    },
  });
  console.log(
    `[seed] extras: targeted one assignment at ${students.length} students, with 1 date override`,
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

  const users = await prisma.user.findMany({ select: { id: true }, take: 8 });
  const course = await prisma.course.findFirst({ select: { id: true } });
  if (users.length === 0) return;

  const kinds: Array<{ action: string; severity: 'INFO' | 'WARNING' | 'ERROR' | 'SECURITY'; category: string; metadata?: object }> = [
    { action: 'LOGIN', severity: 'INFO', category: 'USER' },
    { action: 'LOGIN_FAILED', severity: 'SECURITY', category: 'USER', metadata: { reason: 'invalid password' } },
    { action: 'SUBMISSION_CREATED', severity: 'INFO', category: 'SUBMISSION', metadata: { attempt: 2 } },
    { action: 'GRADE_CHANGED', severity: 'INFO', category: 'SUBMISSION', metadata: { from: 40, to: 85, by: 'hand' } },
    { action: 'COURSE_UPDATED', severity: 'INFO', category: 'COURSE' },
    { action: 'BACKUP_FAILED', severity: 'ERROR', category: 'SYSTEM', metadata: { reason: 'no space left on device' } },
    { action: 'ROSTER_IMPORTED', severity: 'WARNING', category: 'COURSE', metadata: { skipped: 3, reason: 'no matching email' } },
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
 * Everything above, in dependency order: submissions before the grades and comments that refer to
 * work, groups before anything targeted at one.
 */
export const runDevelopmentExtras = async (prisma: PrismaClient) => {
  console.log('[seed] extras: filling in the features seeded data was missing');
  await seedGroups(prisma);
  await seedSubmissions(prisma);
  await seedGrades(prisma);
  await seedComments(prisma);
  await seedGrants(prisma);
  await seedAudienceAndOverrides(prisma);
  await seedActivityLog(prisma);
};
