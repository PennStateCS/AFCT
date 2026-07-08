/**
 * Central builders for API endpoint paths.
 *
 * All client-side `fetch()` calls should build their URL through `apiPaths` rather than
 * hardcoding a string. That way, when a route is renamed or moved during the API
 * reorganization, the change is a single edit here and every caller follows — instead of
 * a sweep across dozens of files.
 *
 * These currently return the EXISTING paths (the reorg has not moved anything yet); later
 * stages rewrite the bodies in place.
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
  courseStudentGrades: (id: string) => `/api/courses/${id}/student-grades`,
  courseEnroll: (id: string) => `/api/courses/${id}/enroll`,
  courseBulkEnroll: (id: string) => `/api/courses/${id}/bulk-enroll`,
  courseLookupUsers: (id: string) => `/api/courses/${id}/lookup-users`,
  courseGroupMemberships: (id: string) => `/api/courses/${id}/group-memberships`,
  courseGroups: (id: string) => `/api/courses/${id}/groups`,
  courseGroup: (id: string, groupId: string) => `/api/courses/${id}/groups/${groupId}`,
  courseGroupMembers: (id: string, groupId: string) =>
    `/api/courses/${id}/groups/${groupId}/members`,
  courseGroupMember: (id: string, groupId: string, userId: string) =>
    `/api/courses/${id}/groups/${groupId}/members/${userId}`,
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
  assignmentGroupProblems: (courseId: string, aid: string) =>
    `/api/courses/${courseId}/assignments/${aid}/group-problems`,

  // --- Global assignment routes -------------------------------------------
  assignments: () => '/api/assignments',
  assignmentById: (id: string) => `/api/assignments/${id}`,
  assignmentByIdProblems: (id: string) => `/api/assignments/${id}/problems`,
  assignmentStudentContext: (id: string) => `/api/assignments/${id}/student-context`,

  // --- Problems ------------------------------------------------------------
  problems: () => '/api/problems',
  problem: (id: string) => `/api/problems/${id}`,
  problemComments: (id: string) => `/api/problems/${id}/comments`,
  problemSubmissions: (id: string) => `/api/problems/${id}/submissions`,

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
    user: (id: string) => `/api/admin/users/${id}`,
    usersBulk: () => '/api/admin/users/bulk',
    usersList: () => '/api/admin/users/list',
    resetPassword: () => '/api/admin/reset-password',
    logs: () => '/api/admin/logs',
    logsExport: () => '/api/admin/logs/export',
    logsExportFields: () => '/api/admin/logs/export/fields',
    settings: () => '/api/admin/settings',
    settingsTls: () => '/api/admin/settings/tls',
    backups: () => '/api/admin/settings/backups',
    backupDownload: (opts?: { file?: string }) =>
      `/api/admin/settings/backups/download${qs({ file: opts?.file })}`,
    status: (opts?: { deep?: boolean }) => `/api/admin/status${opts?.deep ? qs({ deep: 1 }) : ''}`,
    abandonedFiles: () => '/api/admin/status/abandoned-files',
    submissions: () => '/api/admin/submissions',
  },
} as const;
