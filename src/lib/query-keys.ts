/**
 * Central TanStack Query key factory.
 *
 * Every `useQuery`/`fetchQuery`/`invalidateQueries` call should build its key
 * through `queryKeys` rather than hand-writing an array. Benefits:
 *   - One place defines each key's shape, so a rename or a new scoping variable
 *     (e.g. adding `courseId`) is a single edit instead of a cross-file sweep.
 *   - Keys stay consistent, so reads dedupe and invalidations hit the right
 *     entries. Partial keys (e.g. `queryKeys.course.all(id)`) are valid prefixes
 *     for `invalidateQueries`.
 *   - Any variable a `queryFn` reads must appear in the key — the
 *     `@tanstack/query/exhaustive-deps` lint enforces this; building keys here
 *     makes it easy to get right.
 *
 * Mirrors `lib/api-paths.ts` (URL builders). Migration to this factory is
 * incremental; not every call site routes through it yet.
 */

/** Normalize an id list so key order never causes a cache miss (`[a,b]` == `[b,a]`). */
const sortedIds = (ids: readonly string[]): string[] => [...ids].sort();

export const queryKeys = {
  // --- Course lists --------------------------------------------------------
  courses: {
    list: () => ['courses', 'list'] as const,
    nav: () => ['courses', 'nav'] as const,
  },

  // --- A single course and its sections ------------------------------------
  course: {
    /** Prefix for every entry scoped to a course — use to invalidate all of them. */
    all: (courseId: string) => ['course', courseId] as const,
    view: (courseId: string, view: string) => ['course', courseId, view] as const,
    students: (courseId: string) => ['course', courseId, 'students'] as const,
    roster: (courseId: string) => ['course', courseId, 'roster'] as const,
    rosterEntry: (courseId: string, userId: string) =>
      ['course', courseId, 'roster', userId] as const,
    groups: (courseId: string) => ['course', courseId, 'groups'] as const,
    groupMembers: (courseId: string, groupId: string) =>
      ['course', courseId, 'group', groupId, 'members'] as const,
    groupMemberships: (courseId: string) => ['course', courseId, 'group-memberships'] as const,
    grades: (courseId: string) => ['course', courseId, 'grades'] as const,
    studentGrades: (courseId: string) => ['course', courseId, 'student-grades'] as const,
    problems: (courseId: string) => ['course', courseId, 'problems'] as const,
    assignmentsList: (courseId: string) => ['course', courseId, 'assignments-list'] as const,
    activity: (courseId: string, opts: { limit: number }) =>
      ['course', courseId, 'activity', opts] as const,
  },

  // --- Assignments (all nested under their course so course-level invalidation
  //     cascades to them) ---------------------------------------------------
  assignment: {
    /**
     * The assignment "shell" (problems view). Shared by the max-points cell, the
     * student navigator, and the student assignment view so they dedupe onto one
     * read. Nested under the course→assignment prefix (like every key below), so
     * `invalidateQueries(['course', courseId])` reaches it.
     */
    shell: (courseId: string, assignmentId: string) =>
      ['course', courseId, 'assignment', assignmentId, 'shell'] as const,
    /**
     * The caller's own submissions/comments/grades for an assignment — the
     * response is user-specific, so it must never be reused across a user switch
     * (the QueryClient is cleared on identity change; see QueryProvider).
     */
    studentContext: (courseId: string, assignmentId: string) =>
      ['course', courseId, 'assignment', assignmentId, 'student-context'] as const,
    groupsAndMappings: (courseId: string, assignmentId: string) =>
      ['course', courseId, 'assignment', assignmentId, 'groups-and-mappings'] as const,
    gradeBreakdown: (courseId: string, assignmentId: string) =>
      ['course', courseId, 'assignment', assignmentId] as const,
    problemGradesSummary: (courseId: string, assignmentId: string) =>
      ['course', courseId, 'assignment', assignmentId, 'problem-grades', 'summary'] as const,
    problemGrades: (courseId: string, assignmentId: string, studentId: string) =>
      ['course', courseId, 'assignment', assignmentId, 'problem-grades', studentId] as const,
    reviewData: (courseId: string, assignmentId: string, studentId: string) =>
      ['course', courseId, 'assignment', assignmentId, 'review-data', studentId] as const,
  },

  /** Calendar: assignments due in a date range (self-scoped to the caller). */
  assignmentsRange: (startIso: string, endIso: string) =>
    ['assignments', 'range', startIso, endIso] as const,

  // --- Admin / system ------------------------------------------------------
  admin: {
    users: () => ['admin', 'users'] as const,
    usersAll: () => ['admin', 'users', 'all'] as const,
    usersFaculty: () => ['admin', 'users', 'faculty'] as const,
    /** Per-domain status endpoints for the tabbed status dashboard. */
    statusSummary: () => ['admin', 'status', 'summary'] as const,
    statusServer: () => ['admin', 'status', 'server'] as const,
    statusDatabase: () => ['admin', 'status', 'database'] as const,
    statusDocker: () => ['admin', 'status', 'docker'] as const,
    statusNetwork: () => ['admin', 'status', 'network'] as const,
    statusSessions: () => ['admin', 'status', 'sessions'] as const,
    statusFiles: () => ['admin', 'status', 'files'] as const,
    settings: () => ['admin', 'settings'] as const,
    settingsBackups: () => ['admin', 'settings', 'backups'] as const,
    settingsTls: () => ['admin', 'settings', 'tls'] as const,
    logs: <T>(params: T) => ['admin', 'logs', params] as const,
    logsFields: () => ['admin', 'logs', 'fields'] as const,
    /** Submissions for a set of problems — ids are sorted so key order is stable. */
    submissions: (problemIds: readonly string[]) =>
      ['admin', 'submissions', sortedIds(problemIds)] as const,
    /** Cascading filter lists behind the submissions log (courses → assignments → problems). */
    submissionFilters: {
      courses: () => ['admin', 'submission-filters', 'courses'] as const,
      assignments: (courseIds: readonly string[]) =>
        ['admin', 'submission-filters', 'assignments', sortedIds(courseIds)] as const,
      problems: (assignmentIds: readonly string[]) =>
        ['admin', 'submission-filters', 'problems', sortedIds(assignmentIds)] as const,
    },
  },

  // --- Public / self -------------------------------------------------------
  systemSettingsPublic: () => ['system-settings', 'public'] as const,
  profile: () => ['profile'] as const,
} as const;
