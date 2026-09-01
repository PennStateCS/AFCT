import { prisma } from '@/lib/prisma';
import { canManageCourse } from '@/lib/permissions';
import type { PermissionUser } from '@/lib/permissions';
import type { ViewerFileKind } from '@/lib/viewer-link';

/**
 * Where a file in the viewer came from: its course, what it belongs to, and when it arrived.
 *
 * Server-only. It reads the database and resolves permissions, and the standalone viewer page
 * loads it during render and passes the result down as plain data, so none of this reaches the
 * browser.
 *
 * Deliberately carries **nothing about grades**: not the recorded mark, not the evaluator's
 * verdict, not whether the attempt was correct. The viewer was scoped as a tool for looking at
 * the machines, and a properties panel is exactly where that decision would quietly erode.
 */
export type ViewerProperties = {
  /** Rows in display order. Kept as a list so the panel renders without knowing the shape. */
  rows: { label: string; value: string }[];
};

/** A date an operator can read, in the machine's own timezone-free form. */
function stamp(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/**
 * Look up what a viewer file belongs to, or null.
 *
 * Null covers both "no such file" and "not yours to see", on purpose: telling the two apart
 * would let somebody probe for which files exist by watching the panel change.
 *
 * Authorisation mirrors the file routes exactly rather than inventing a second rule. A
 * submission is visible to the student who submitted it and to course staff; a problem or
 * solution file is staff only.
 */
export async function loadViewerProperties(
  kind: ViewerFileKind,
  file: string,
  user: PermissionUser,
): Promise<ViewerProperties | null> {
  if (kind === 'submissions') {
    const submission = await prisma.submission.findFirst({
      where: { fileName: file },
      select: {
        originalFileName: true,
        createdAt: true,
        studentId: true,
        courseId: true,
        student: { select: { firstName: true, lastName: true, email: true } },
        studentGroup: { select: { name: true } },
        course: { select: { name: true, code: true } },
        assignmentProblem: {
          select: {
            assignment: { select: { title: true } },
            problem: { select: { title: true, type: true } },
          },
        },
      },
    });
    if (!submission) return null;

    const allowed =
      (!!user?.id && submission.studentId === user.id) ||
      (await canManageCourse(user, submission.courseId));
    if (!allowed) return null;

    // The person is always named, group or not: on group work the grade counts for the whole
    // group, but somebody still uploaded this file and that is worth being able to see.
    const person =
      [submission.student?.firstName, submission.student?.lastName].filter(Boolean).join(' ') ||
      submission.student?.email ||
      'Unknown';
    const group = submission.studentGroup?.name ?? null;

    return {
      rows: [
        { label: 'File', value: submission.originalFileName ?? file },
        // Said outright, because a solution and a student's attempt look identical on the
        // canvas and mistaking one for the other is the expensive confusion here.
        {
          label: 'Kind',
          value: group ? 'Student submission (group work)' : 'Student submission',
        },
        {
          label: 'Course',
          value: submission.course?.code
            ? `${submission.course.code} ${submission.course.name}`
            : (submission.course?.name ?? 'Unknown'),
        },
        {
          label: 'Assignment',
          value: submission.assignmentProblem?.assignment?.title ?? 'Unknown',
        },
        { label: 'Problem', value: submission.assignmentProblem?.problem?.title ?? 'Unknown' },
        { label: 'Type', value: submission.assignmentProblem?.problem?.type ?? 'Unknown' },
        ...(group ? [{ label: 'Group', value: group }] : []),
        { label: group ? 'Uploaded by' : 'Student', value: person },
        { label: 'Submitted', value: stamp(submission.createdAt) },
      ],
    };
  }

  // A problem's own file, or the solution posted with it. Both hang off Problem and are staff
  // only, which is the rule their file routes apply.
  const problem = await prisma.problem.findFirst({
    where: { fileName: file },
    select: {
      title: true,
      type: true,
      originalFileName: true,
      createdAt: true,
      updatedAt: true,
      courseId: true,
      course: { select: { name: true, code: true } },
    },
  });
  if (!problem) return null;
  if (!(await canManageCourse(user, problem.courseId))) return null;

  return {
    rows: [
      { label: 'File', value: problem.originalFileName ?? file },
      {
        label: 'Kind',
        value: kind === 'solutions' ? "Instructor's solution" : 'Problem file',
      },
      {
        label: 'Course',
        value: problem.course?.code
          ? `${problem.course.code} ${problem.course.name}`
          : (problem.course?.name ?? 'Unknown'),
      },
      { label: 'Problem', value: problem.title },
      { label: 'Type', value: problem.type ?? 'Unknown' },
      { label: 'Added', value: stamp(problem.createdAt) },
      { label: 'Last changed', value: stamp(problem.updatedAt) },
    ],
  };
}
