/**
 * Central builders for API endpoint paths.
 *
 * All client-side `fetch()` calls should build their URL through `apiPaths` rather than
 * hardcoding a string. That way, when a route is renamed or moved, the change is a single
 * edit here and every caller follows, instead of a sweep across dozens of files.
 */

type QueryValue = string | number | boolean | null | undefined;

/** Builds a `?a=1&b=2` suffix, skipping null/undefined values. Returns '' when empty. */
function qs(params: Record<string, QueryValue>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const apiPaths = {
  // --- Courses -------------------------------------------------------------
  courses: () => '/api/courses',
  course: (id: string, opts?: { view?: string }) => `/api/courses/${id}${qs({ view: opts?.view })}`,
  courseDuplicate: (id: string) => `/api/courses/${id}/duplicate`,
  coursePublish: (id: string) => `/api/courses/${id}/publish`,
  courseArchive: (id: string) => `/api/courses/${id}/archive`,
  courseActivity: (id: string, opts?: { limit?: number; offset?: number }) =>
    `/api/courses/${id}/activity${qs({ limit: opts?.limit, offset: opts?.offset })}`,
  courseStudents: (id: string) => `/api/courses/${id}/students`,
  courseGrades: (id: string) => `/api/courses/${id}/grades`,
  courseGradesExport: (id: string) => `/api/courses/${id}/grades/export`,
  courseStudentGrades: (id: string) => `/api/courses/${id}/student-grades`,
  courseRoster: (id: string) => `/api/courses/${id}/roster`,
  courseRosterBulk: (id: string) => `/api/courses/${id}/roster/bulk`,
  courseLookupUsers: (id: string) => `/api/courses/${id}/lookup-users`,
  // Group sets (redesigned group management)
  courseGroupSets: (id: string) => `/api/courses/${id}/group-sets`,
  courseGroupSet: (id: string, setId: string) => `/api/courses/${id}/group-sets/${setId}`,
  courseGroupSetDuplicate: (id: string, setId: string) =>
    `/api/courses/${id}/group-sets/${setId}/duplicate`,
  courseGroupSetGroups: (id: string, setId: string) =>
    `/api/courses/${id}/group-sets/${setId}/groups`,
  courseGroupSetGroup: (id: string, setId: string, groupId: string) =>
    `/api/courses/${id}/group-sets/${setId}/groups/${groupId}`,
  courseGroupSetMemberships: (id: string, setId: string) =>
    `/api/courses/${id}/group-sets/${setId}/memberships`,
  courseGroupSetRandomAssign: (id: string, setId: string) =>
    `/api/courses/${id}/group-sets/${setId}/random-assign`,
  courseProblems: (id: string) => `/api/courses/${id}/problems`,
  courseProblem: (id: string, pid: string) => `/api/courses/${id}/problems/${pid}`,
  courseRosterEntry: (id: string, userId: string) => `/api/courses/${id}/roster/${userId}`,
  courseAssignments: (id: string) => `/api/courses/${id}/assignments`,
  courseJoin: () => '/api/courses/join',

  // --- "My" (self-scoped, /api/me/*) --------------------------------------
  me: () => '/api/me',
  myPassword: () => '/api/me/password',
  myCourses: (opts?: { view?: 'nav' }) => `/api/me/courses${qs({ view: opts?.view })}`,
  myEnrollments: () => '/api/me/enrollments',
  myAssignments: (start?: string, end?: string) => `/api/me/assignments${qs({ start, end })}`,

  // --- Assignments (course-nested under /assignments/[aid]) ----------------
  assignment: (courseId: string, aid: string, opts?: { view?: string }) =>
    `/api/courses/${courseId}/assignments/${aid}${qs({ view: opts?.view })}`,
  assignmentProblems: (courseId: string, aid: string) =>
    `/api/courses/${courseId}/assignments/${aid}/problems`,
  assignmentProblem: (courseId: string, aid: string, pid: string) =>
    `/api/courses/${courseId}/assignments/${aid}/problems/${pid}`,
  assignmentProblemGrade: (courseId: string, aid: string, pid: string, studentId: string) =>
    `/api/courses/${courseId}/assignments/${aid}/problems/${pid}/grade/${studentId}`,
  assignmentProblemGrades: (courseId: string, aid: string, studentId: string) =>
    `/api/courses/${courseId}/assignments/${aid}/problem-grades/${studentId}`,
  assignmentProblemGradesSummary: (courseId: string, aid: string) =>
    `/api/courses/${courseId}/assignments/${aid}/problem-grades/summary`,
  assignmentReviewData: (courseId: string, aid: string, studentId: string) =>
    `/api/courses/${courseId}/assignments/${aid}/review-data/${studentId}`,
  assignmentSubmissions: (courseId: string, aid: string, sid: string) =>
    `/api/courses/${courseId}/assignments/${aid}/submissions/${sid}`,
  assignmentStudentContext: (courseId: string, aid: string) =>
    `/api/courses/${courseId}/assignments/${aid}/student-context`,
  assignmentStudentGroup: (courseId: string, aid: string, studentId: string) =>
    `/api/courses/${courseId}/assignments/${aid}/student-group/${studentId}`,
  assignmentType: (courseId: string, aid: string) =>
    `/api/courses/${courseId}/assignments/${aid}/type`,
  assignmentAssignees: (courseId: string, aid: string) =>
    `/api/courses/${courseId}/assignments/${aid}/assignees`,
  assignmentOverrides: (courseId: string, aid: string) =>
    `/api/courses/${courseId}/assignments/${aid}/overrides`,
  assignmentOverride: (courseId: string, aid: string, oid: string) =>
    `/api/courses/${courseId}/assignments/${aid}/overrides/${oid}`,

  // --- Global assignment routes -------------------------------------------
  assignmentByIdProblems: (id: string) => `/api/assignments/${id}/problems`,

  // --- Comments / submissions ---------------------------------------------
  comments: (opts?: { commentId?: string }) => `/api/comments${qs({ commentId: opts?.commentId })}`,
  submissions: () => '/api/submissions',
  submissionRerun: (id: string) => `/api/submissions/${id}/rerun`,
  courseSubmissionsRerun: (id: string) => `/api/courses/${id}/submissions/rerun`,

  // --- Account -------------------------------------------------------------
  user: (id: string) => `/api/users/${id}`,
  sessionExtend: () => '/api/session/extend',

  // --- Public / settings ---------------------------------------------------
  systemSettingsPublic: () => '/api/system-settings/public',

  // --- Served files (avatars, uploads, solutions) --------------------------
  // Callers pass the filename already encoded where they previously did so; these
  // builders only interpolate, to preserve the existing (mixed) encoding behavior.
  files: {
    pfp: (file: string) => `/api/files/pfps/${file}`,
    problem: (file: string) => `/api/files/problems/${file}`,
    submission: (file: string) => `/api/files/submissions/${file}`,
    solution: (file: string, opts?: { download?: boolean }) =>
      `/api/files/solutions/${file}${opts?.download ? '?download=1' : ''}`,
  },

  // --- Admin ---------------------------------------------------------------
  admin: {
    users: (opts?: { role?: string }) => `/api/admin/users${qs({ role: opts?.role })}`,
    usersBulk: () => '/api/admin/users/bulk',
    usersList: () => '/api/admin/users/list',
    resetPassword: () => '/api/admin/reset-password',
    logs: () => '/api/admin/logs',
    logsExport: () => '/api/admin/logs/export',
    logsExportFields: () => '/api/admin/logs/export/fields',
    settings: () => '/api/admin/settings',
    settingsTls: () => '/api/admin/settings/tls',
    backups: () => '/api/admin/settings/backups',
    upgrade: () => '/api/admin/settings/upgrade',
    backupDownload: (opts?: { file?: string }) =>
      `/api/admin/settings/backups/download${qs({ file: opts?.file })}`,
    // Per-domain status endpoints (tabbed status dashboard).
    statusSummary: () => '/api/admin/status/summary',
    statusServer: () => '/api/admin/status/server',
    statusDatabase: () => '/api/admin/status/database',
    statusDocker: () => '/api/admin/status/docker',
    statusNetwork: () => '/api/admin/status/network',
    statusSessions: () => '/api/admin/status/sessions',
    statusFiles: () => '/api/admin/status/files',
    submissions: () => '/api/admin/submissions',
  },
} as const;
