// src/lib/client-course-tree.ts
//
// Shared builders for the native client's course data. The client fetches the whole
// tree in one call (`GET /api/client/v1/tree`) and filters it locally, so these helpers
// centralize the per-role visibility rules that the flat `/courses` endpoint and the
// nested tree endpoint must agree on.
import { prisma } from '@/lib/prisma';
import type { ClientTokenUser } from '@/lib/client-auth';
import { getCoursesListForUser } from '@/lib/courses-list';
import { getStudentCourseAssignments } from '@/lib/student-assignments';

export type ClientCourse = {
  id: string;
  name: string;
  code: string;
  semester: string;
  timezone: string;
  isPublished: boolean;
  isArchived: boolean;
  role: string | null;
};

export type ClientProblem = {
  id: string;
  title: string | null;
  description: string | null;
  type: string | null;
  maxStates: number | null;
  isDeterministic: boolean | null;
  maxPoints: number;
  maxSubmissions: number;
  submissionCount: number;
  grade: number | null;
  status: string;
  /** True once the student has earned full marks (autograde fans a correct grade out to
   *  every group member, so a groupmate's solve counts too). Drives the Unsolved filter. */
  solved: boolean;
};

export type ClientAssignment = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  unlockAt: string | null;
  lateCutoff: string | null;
  allowLateSubmissions: boolean;
  isGroup: boolean;
  groupName: string | null;
  problems: ClientProblem[];
};

export type ClientCourseTree = ClientCourse & { assignments: ClientAssignment[] };

export type ClientTree = { serverTime: string; courses: ClientCourseTree[] };

/**
 * The courses visible to the client user, scoped to their token. Mirrors the web app's
 * per-course rules and never lists a deleted or archived course:
 *   - Admin: every non-archived course (published or not), enrolled or not.
 *   - Faculty/TA: their non-archived courses (published or not) where they are staff.
 *   - Student: their published non-archived courses currently within the start/end range.
 * A user who is staff in one course and a student in another is judged per course.
 */
export async function getVisibleClientCourses(user: ClientTokenUser): Promise<ClientCourse[]> {
  const courses = (await getCoursesListForUser(user.id, user.isAdmin ? 'ADMIN' : 'STUDENT')).filter(
    (c) => !c.isArchived,
  );

  const rosters = await prisma.roster.findMany({
    where: { userId: user.id, courseId: { in: courses.map((c) => c.id) } },
    select: { courseId: true, role: true },
  });
  const roleByCourse = new Map(rosters.map((r) => [r.courseId, r.role]));

  const now = new Date();
  const visible = courses.filter((c) => {
    if (user.isAdmin) return true;
    const role = roleByCourse.get(c.id);
    if (role === 'FACULTY' || role === 'TA') return true;
    return c.startDate <= now && now <= c.endDate;
  });

  return visible.map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    semester: c.semester,
    timezone: c.timezone,
    isPublished: c.isPublished,
    isArchived: c.isArchived,
    role: roleByCourse.get(c.id) ?? (user.isAdmin ? 'ADMIN' : null),
  }));
}

/**
 * The full nested tree the client renders: every visible course with its assignments and
 * their problems, already resolved for this user (effective dates, own grade/status, and
 * a derived `solved`). Staff (admin / FACULTY / TA in the course) see every assignment;
 * students see only published assignments assigned to them that have unlocked. Never
 * includes answer-key files.
 */
export async function buildClientCourseTree(user: ClientTokenUser): Promise<ClientTree> {
  const courses = await getVisibleClientCourses(user);

  const perCourse = await Promise.all(
    courses.map(async (c) => {
      const staff = user.isAdmin || c.role === 'FACULTY' || c.role === 'TA';
      const all = await getStudentCourseAssignments(
        user.id,
        c.id,
        staff ? { includeUnpublished: true, includeUnassigned: true } : {},
      );
      // A student may not see an assignment before its available date; staff always may.
      const assignments = staff ? all : all.filter((a) => !a.locked);
      return { course: c, assignments };
    }),
  );

  // Resolve the caller's own group name for every group assignment in one query.
  const groupSetIds = [
    ...new Set(
      perCourse.flatMap(({ assignments }) =>
        assignments.map((a) => a.groupSetId).filter((id): id is string => id != null),
      ),
    ),
  ];
  const memberships = groupSetIds.length
    ? await prisma.groupMembership.findMany({
        where: { userId: user.id, groupSetId: { in: groupSetIds } },
        select: { groupSetId: true, group: { select: { name: true } } },
      })
    : [];
  const groupNameBySet = new Map(memberships.map((m) => [m.groupSetId, m.group.name]));

  const tree: ClientCourseTree[] = perCourse.map(({ course, assignments }) => ({
    ...course,
    assignments: assignments.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      dueDate: a.dueDate?.toISOString() ?? null,
      unlockAt: a.unlockAt?.toISOString() ?? null,
      lateCutoff: a.lateCutoff?.toISOString() ?? null,
      allowLateSubmissions: a.allowLateSubmissions,
      isGroup: a.groupSetId != null,
      groupName: a.groupSetId ? (groupNameBySet.get(a.groupSetId) ?? null) : null,
      problems: a.problems.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        type: p.type,
        maxStates: p.maxStates,
        isDeterministic: p.isDeterministic,
        maxPoints: p.maxPoints,
        maxSubmissions: p.maxSubmissions,
        submissionCount: p.submissionCount,
        grade: p.grade,
        status: p.status,
        solved: p.grade != null && p.maxPoints > 0 && p.grade >= p.maxPoints,
      })),
    })),
  }));

  return { serverTime: new Date().toISOString(), courses: tree };
}
