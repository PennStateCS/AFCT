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
  courseStudents: (id: string, opts?: { includeDropped?: boolean }) =>
    `/api/courses/${id}/students${opts?.includeDropped ? '?includeDropped=1' : ''}`,
  /** The gradebook's assignment columns and student total. */
  courseGradeColumns: (id: string) => `/api/courses/${id}/grades?part=columns`,
  /** One page of the gradebook: students with their assigned flags and grades. */
  courseGradePage: (
    id: string,
    opts: { page?: number; pageSize?: number; q?: string; sortBy?: string; sortDir?: string },
  ) =>
    `/api/courses/${id}/grades${qs({
      page: opts.page,
      pageSize: opts.pageSize,
      q: opts.q || undefined,
      sortBy: opts.sortBy,
      sortDir: opts.sortDir,
    })}`,
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
  courseProblemDuplicate: (id: string, pid: string) =>
    `/api/courses/${id}/problems/${pid}/duplicate`,
  // Import a problem from another course INTO this (destination) course.
  courseProblemImport: (id: string) => `/api/courses/${id}/problems/import`,
  courseRosterEntry: (id: string, userId: string) => `/api/courses/${id}/roster/${userId}`,
  // Drop / re-enroll a student (PATCH { status }).
  courseRosterStatus: (id: string, userId: string) =>
    `/api/courses/${id}/roster/${userId}/status`,
  courseRosterResetPassword: (id: string, userId: string) =>
    `/api/courses/${id}/roster/${userId}/reset-password`,
  courseAssignments: (id: string, opts?: { includeUnpublished?: boolean }) =>
    `/api/courses/${id}/assignments${qs({ includeUnpublished: opts?.includeUnpublished ? '1' : undefined })}`,
  courseJoin: () => '/api/courses/join',

  // --- "My" (self-scoped, /api/me/*) --------------------------------------
  me: () => '/api/me',
  myPassword: () => '/api/me/password',
  myCourses: (opts?: { view?: 'nav' }) => `/api/me/courses${qs({ view: opts?.view })}`,
  myEnrollments: () => '/api/me/enrollments',
  myAssignments: (start?: string, end?: string) => `/api/me/assignments${qs({ start, end })}`,
  // Courses the caller can manage (faculty/TA, or all for admins), for the import picker.
  myManageableCourses: (opts?: { excludeCourseId?: string }) =>
    `/api/me/manageable-courses${qs({ excludeCourseId: opts?.excludeCourseId })}`,

  // --- Assignments (course-nested under /assignments/[aid]) ----------------
  assignment: (courseId: string, aid: string, opts?: { view?: string }) =>
    `/api/courses/${courseId}/assignments/${aid}${qs({ view: opts?.view })}`,
  assignmentDuplicate: (courseId: string, aid: string) =>
    `/api/courses/${courseId}/assignments/${aid}/duplicate`,
  // Import an assignment from another course INTO this (destination) course.
  assignmentImport: (courseId: string) => `/api/courses/${courseId}/assignments/import`,
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
  assignmentStatistics: (courseId: string, aid: string) =>
    `/api/courses/${courseId}/assignments/${aid}/statistics`,
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
  problemSubmissionGrants: (courseId: string, aid: string, pid: string) =>
    `/api/courses/${courseId}/assignments/${aid}/problems/${pid}/grants`,
  problemSubmissionGrant: (courseId: string, aid: string, pid: string, gid: string) =>
    `/api/courses/${courseId}/assignments/${aid}/problems/${pid}/grants/${gid}`,

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
  // Whether an email is already registered (used by signup and the admin
  // Change Email dialog to warn before submitting).
  checkEmail: (email: string) => `/api/auth/check-email${qs({ email })}`,

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
    unlockAccount: () => '/api/admin/unlock-account',
    logs: () => '/api/admin/logs',
    logsExport: () => '/api/admin/logs/export',
    logsExportFields: () => '/api/admin/logs/export/fields',
    settings: () => '/api/admin/settings',
    settingsTls: () => '/api/admin/settings/tls',
    settingsTlsAcmeProgress: () => '/api/admin/settings/tls/acme-progress',
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
    statusRateLimits: () => '/api/admin/status/rate-limits',
    statusRateLimitsClear: () => '/api/admin/status/rate-limits/clear',
    submissions: () => '/api/admin/submissions',
  },
} as const;
