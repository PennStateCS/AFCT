/**
 * One line saying what an activity-log entry actually did.
 *
 * The log lists an action name and hides the metadata behind a dialog, so "LTI ROSTER SYNCED"
 * tells a reader nothing about whether six people were added or sixty dropped. This turns the
 * metadata into a sentence for the actions where the metadata *is* the meaning.
 *
 * Returns null for anything not covered, so the column stays empty rather than inventing a
 * summary from fields it does not understand. Add cases as actions gain metadata worth reading.
 */

type Metadata = Record<string, unknown> | null | undefined;

const num = (meta: Metadata, key: string): number =>
  typeof meta?.[key] === 'number' ? (meta[key] as number) : 0;

const str = (meta: Metadata, key: string): string | null =>
  typeof meta?.[key] === 'string' && meta[key] ? (meta[key] as string) : null;

/** "6 added, 3 dropped" — only the parts that happened, so nothing reads as a row of zeroes. */
function counts(meta: Metadata): string {
  const parts: string[] = [];
  const add = (n: number, label: string) => {
    if (n > 0) parts.push(`${n} ${label}`);
  };
  add(num(meta, 'added'), 'added');
  add(num(meta, 'restored'), 're-enrolled');
  add(num(meta, 'dropped'), 'dropped');
  add(num(meta, 'accountsCreated'), 'new accounts');
  add(num(meta, 'identitiesLinked'), 'sign-ins connected');
  return parts.length > 0 ? parts.join(', ') : 'nothing changed';
}

/**
 * Display verbs. The stored action is untouched: it is the key search, filters, exports and the
 * research record all use.
 *
 * Exceptions first, then a suffix rule (most actions end in what happened), then a prefix rule.
 * Anything unmatched falls back to its own name, sentence-cased, so a new action never renders
 * blank.
 */
const ACTION_VERB: Record<string, string> = {
  LOGIN_SUCCESS: 'Signed in',
  LOGIN: 'Signed in',
  USER_LOGIN: 'Signed in',
  CLIENT_LOGIN: 'Signed in',
  LOGOUT: 'Signed out',
  CLIENT_LOGOUT: 'Signed out',
  USER_SIGNUP: 'Created',
  SUBMISSION_CREATED: 'Submitted',
  SUBMISSION_AUTOGRADED: 'Graded',
  SUBMISSION_AUTOGRADE_SKIPPED: 'Skipped',
  SUBMISSION_RERUN: 'Re-ran',
  COURSE_SUBMISSIONS_RERUN: 'Re-ran',
  SUBMISSION_QUEUE_REAPED: 'Reclaimed',
  SUBMISSION_LIMIT_REACHED: 'Rejected',
  SUBMISSION_RATE_LIMITED: 'Rejected',
  SUBMISSION_FILE_TOO_LARGE: 'Rejected',
  SUBMISSION_NOT_ASSIGNED: 'Rejected',
  SUBMISSION_UNPUBLISHED_ASSIGNMENT: 'Rejected',
  SUBMISSION_INVALID_REQUEST: 'Rejected',
  SUBMISSION_FORBIDDEN: 'Denied',
  SUBMISSION_UNAUTHORIZED: 'Denied',
  PROBLEM_INVALID_FILE_STRUCTURE: 'Rejected',
  PROBLEM_GRADE_UPDATED: 'Graded',
  GROUP_PROBLEM_GRADE_UPDATED: 'Graded',
  PROBLEM_GRADE_CLEARED: 'Cleared',
  GRADE_UPDATED: 'Graded',
  GRADE_OVERRIDE: 'Overrode',
  GRADE_HELD_MANUAL: 'Held',
  GRADE_RELEASED_TO_AUTOGRADER: 'Released',
  COURSE_UNARCHIVED: 'Restored',
  COURSE_JOINED: 'Joined',
  REENROLL_IN_COURSE: 'Re-enrolled',
  DROP_FROM_COURSE: 'Dropped',
  REMOVE_FROM_COURSE: 'Removed',
  ENROLL_USER: 'Enrolled',
  BULK_ENROLL_USERS: 'Enrolled',
  BULK_CREATE_USERS: 'Created',
  CHANGE_COURSE_ROLE: 'Changed',
  CHANGE_ASSIGNMENT_TYPE: 'Changed',
  CHANGE_PASSWORD: 'Changed',
  SET_PASSWORD: 'Set',
  RESET_PASSWORD: 'Reset',
  RESET_STUDENT_PASSWORD: 'Reset',
  UNLOCK_ACCOUNT: 'Unlocked',
  CLEAR_RATE_LIMIT: 'Cleared',
  GRANT_EXTRA_SUBMISSIONS: 'Granted',
  REVOKE_EXTRA_SUBMISSIONS: 'Revoked',
  SESSION_EXTENDED: 'Extended',
  USER_IDENTITY_REASSIGNED: 'Reassigned',
  SYSTEM_UPDATE_ROLLED_BACK: 'Rolled back',
  SYSTEM_UPDATER_SELF_UPDATE_REQUESTED: 'Requested',
  TLS_CERT_RESET: 'Reset',
  ABANDONED_FILES_PURGED: 'Purged',
  PASSWORD_RESET_COMPLETED: 'Reset',
  PROFILE_UPDATED: 'Updated',
  LTI_ROSTER_SYNCED: 'Synced',
  LTI_SCORE_QUEUED: 'Queued',
  LTI_SCORE_SENT: 'Sent',
  LTI_GRADES_PUSH_REQUESTED: 'Sent',
  ADMIN_LOGS_VIEWED: 'Viewed',
  ADMIN_LOGS_EXPORTED: 'Exported',
  ADMIN_STATUS_VIEWED: 'Viewed',
  ADMIN_SUBMISSIONS_VIEWED: 'Viewed',
  SYSTEM_SETTINGS_VIEWED: 'Viewed',
  COURSE_ROSTER_VIEWED: 'Viewed',
  USER_ADMIN_GRANTED: 'Granted',
  USER_ADMIN_REVOKED: 'Revoked',
  GROUP_MEMBERSHIP_ASSIGNED: 'Moved',
  GROUP_MEMBERSHIP_REMOVED: 'Removed',
  ASSIGNMENT_GRADE_SYNC_UPDATED: 'Updated',
  LTI_DEEP_LINK_RETURNED: 'Linked',
  LTI_DEEP_LINK_REMOVED: 'Unlinked',
  SYSTEM_BACKUP_DOWNLOADED: 'Downloaded',
};

/**
 * Verbs that depend on which field a generic update touched.
 *
 * Publishing goes through the same PATCH as renaming, so the stored action is
 * `UPDATE_ASSIGNMENT` either way; adding a stored action for some saves and not others would
 * make counts of it mean two things. Same trick as `LOGIN_SUCCESS` reading its provider.
 *
 * Only when publishing was the only change: a save that also moved the due date is an update,
 * and calling it "Published" would hide the date.
 */
const DERIVED_VERB: Record<string, (metadata: Metadata) => string | null> = {
  UPDATE_ASSIGNMENT: (metadata) => {
    const fields = Array.isArray(metadata?.changedFields)
      ? (metadata.changedFields as string[])
      : null;
    if (!fields || fields.length !== 1 || fields[0] !== 'isPublished') return null;
    const change = (metadata?.changes as Record<string, { to?: unknown }> | undefined)?.isPublished;
    if (!change) return null;
    return change.to === true ? 'Published' : change.to === false ? 'Unpublished' : null;
  },
};

/** What an action ends with, which for most of them is the thing that happened. */
const VERB_BY_SUFFIX: [RegExp, string][] = [
  [/_ROLLED_BACK$/, 'Rolled back'],
  [/_(DENIED|FORBIDDEN|UNAUTHORIZED)$/, 'Denied'],
  [/_(REJECTED|CONFLICT)$/, 'Rejected'],
  [/_(FAILED|ERROR)$/, 'Failed'],
  [/_INVALID(_[A-Z_]+)?$/, 'Rejected'],
  [/_VIEWED$/, 'Viewed'],
  [/_CREATED$/, 'Created'],
  [/_UPDATED$/, 'Updated'],
  [/_DELETED$/, 'Deleted'],
  [/_REMOVED$/, 'Removed'],
  [/_PURGED$/, 'Purged'],
  [/_PUBLISHED$/, 'Published'],
  [/_UNPUBLISHED$/, 'Unpublished'],
  [/_ARCHIVED$/, 'Archived'],
  [/_UNARCHIVED$/, 'Restored'],
  [/_DUPLICATED$/, 'Duplicated'],
  [/_SYNCED$/, 'Synced'],
  [/_LINKED$/, 'Linked'],
  [/_UNLINKED$/, 'Unlinked'],
  [/_REGISTERED$/, 'Registered'],
  [/_ISSUED$/, 'Issued'],
  [/_REVOKED$/, 'Revoked'],
  [/_GRANTED$/, 'Granted'],
  [/_SENT$/, 'Sent'],
  [/_QUEUED$/, 'Queued'],
  [/_RECEIVED$/, 'Received'],
  [/_STORED$/, 'Stored'],
  [/_SKIPPED$/, 'Skipped'],
  [/_DISCARDED$/, 'Discarded'],
  [/_EXPORTED$/, 'Exported'],
  [/_IMPORTED$/, 'Imported'],
  [/_REQUESTED$/, 'Requested'],
  [/_COMPLETED$/, 'Completed'],
  [/_STARTED$/, 'Started'],
  [/_CONFIRMED$/, 'Confirmed'],
  [/_REASSIGNED$/, 'Reassigned'],
  [/_EXTENDED$/, 'Extended'],
  [/_RESET$/, 'Reset'],
];

/** What an action starts with, for the ones written the other way round. */
const VERB_BY_PREFIX: Record<string, string> = {
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  VIEW: 'Viewed',
  ADD: 'Added',
  REMOVE: 'Removed',
  CHANGE: 'Changed',
  IMPORT: 'Imported',
  DUPLICATE: 'Duplicated',
  DOWNLOAD: 'Downloaded',
  ENROLL: 'Enrolled',
  GRANT: 'Granted',
  REVOKE: 'Revoked',
  RESET: 'Reset',
  SET: 'Set',
  UNLOCK: 'Unlocked',
  CLEAR: 'Cleared',
  DROP: 'Dropped',
};

/**
 * An address as a reader should see it.
 *
 * Three cases the stored value does not handle on its own: the IPv4-mapped IPv6 prefix, which
 * is noise in front of an ordinary address; loopback, which is a machine talking to itself;
 * and `system`, the sentinel the submission worker and trial runner write because no request
 * made those entries. Capitalised so it reads as a word rather than as something typed in.
 *
 * Presentation only. The stored value is what the details dialog and Copy JSON carry.
 */
export function displayIpAddress(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.toLowerCase() === 'system') return 'System';
  if (raw === '::1' || raw === '127.0.0.1') return 'localhost';
  return raw.replace(/^::ffff:(?=\d{1,3}(?:\.\d{1,3}){3}$)/i, '');
}

/**
 * The action as a person reads it. Presentation only and one-way; nothing maps back. Several
 * actions sharing a verb is fine, since the object column says which is which.
 */
export function actionLabel(action: string, metadata?: Metadata): string {
  const derived = DERIVED_VERB[action]?.(metadata);
  if (derived) return derived;

  const known = ACTION_VERB[action];
  if (known) return known;

  for (const [pattern, verb] of VERB_BY_SUFFIX) {
    if (pattern.test(action)) return verb;
  }

  const prefix = VERB_BY_PREFIX[action.split('_')[0] ?? ''];
  if (prefix) return prefix;

  // Verb in the middle, reason after it: SUBMISSION_REJECTED_LATE_CUTOFF. The reason belongs
  // in the other column.
  for (const [word, verb] of [
    ['REJECTED', 'Rejected'],
    ['DENIED', 'Denied'],
    ['FAILED', 'Failed'],
    ['DISCARDED', 'Discarded'],
    ['SKIPPED', 'Skipped'],
  ] as const) {
    if (action.includes(`_${word}_`)) return verb;
  }

  // Unrecognised: its own name, sentence-cased, rather than blank.
  const words = action.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Where a look at somebody's work came from, in words rather than the code's own labels. */
const VIEW_SOURCE: Record<string, string> = {
  web: 'the web app',
  client: 'the desktop client',
  'review-data': 'the review workspace',
};

/** How an identity came to be attached, in the words a person would use. */
const VIA: Record<string, string> = {
  SELF_SERVICE: 'connected by the account holder',
  AUTO_VERIFIED_EMAIL: 'matched on email',
  JUST_IN_TIME: 'created on first sign-in',
  ADMIN: 'connected by an administrator',
};

/** "due date 24 Aug to 1 Sep" — the change itself, which is what a reader is looking for. */
/**
 * Fields whose value is never printed. The settings route already allowlists non-secret fields;
 * this is the second lock, so the guarantee does not depend on every future producer.
 */
const SECRET_FIELD = /(password|secret|token|apiKey|privateKey|credential|clientSecret)/i;

function describeChanges(metadata: Metadata): string | null {
  const changes = metadata?.changes as Record<string, { from: unknown; to: unknown }> | undefined;
  if (!changes || Object.keys(changes).length === 0) return null;

  const shorten = (value: unknown) => {
    if (value === null || value === undefined) return 'nothing';
    const text = String(value);
    // Long values ruin a table row, and the detail view has the whole thing.
    return text.length > 40 ? `${text.slice(0, 40)}...` : text;
  };

  return Object.entries(changes)
    .map(([field, change]) => {
      // What happened to it, never what it is.
      if (SECRET_FIELD.test(field)) {
        const cleared = change.to === null || change.to === undefined || change.to === '';
        return `${label(field)}: ${cleared ? 'cleared' : 'set'}`;
      }
      return `${label(field)}: ${shorten(change.from)} to ${shorten(change.to)}`;
    })
    .join('; ');
}

// Failing actions record why under `reason` (a guard refused), `error` (logError caught a
// throw) or `message` (from the updater). Matched on the name so a new failure action is
// covered without adding a case for it.
const FAILURE = /_(ERROR|DENIED|FAILED|REJECTED|INVALID|UNAUTHORIZED|CONFLICT)$/;

/** "3 of 5" style counts, dropping the parts that are zero so nothing reads as a row of noughts. */
function tally(pairs: Array<[number, string]>): string | null {
  const parts = pairs.filter(([n]) => n > 0).map(([n, word]) => `${n} ${word}`);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** The first of several keys that carries a string, since the same idea is spelled a few ways. */
function firstStr(meta: Metadata, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = str(meta, key);
    if (value) return value;
  }
  return null;
}

/** The first of several keys that carries a number. */
function firstNum(meta: Metadata, ...keys: string[]): number {
  for (const key of keys) {
    if (typeof meta?.[key] === 'number') return meta[key] as number;
  }
  return 0;
}

/** `n thing` / `n things`, so a count reads as English rather than as `1 students`. */
const plural = (n: number, word: string, plural = `${word}s`) => `${n} ${n === 1 ? word : plural}`;

/** The records an entry points at, named rather than left as identifiers. */
export type RelatedRecords = {
  course?: string | null;
  assignment?: string | null;
  problem?: string | null;
  submission?: string | null;
};

/**
 * Naming the object an action was done to: "Homework 2 in CMPSC 464", not "for everyone".
 *
 * Resolved relations first (they show the current name), then metadata (the only source that
 * survives a deletion, which is why destructive actions record names as they go), then the id.
 * Pure formatting over what the API already returned; nothing here queries.
 */
function courseNamed(meta: Metadata, related?: RelatedRecords | null): string | null {
  const resolved = related?.course?.trim();
  if (resolved) return resolved;
  // `newCourseCode` is what a duplication records; `name` alone is ambiguous enough that it
  // is only read when a code sits beside it.
  const code = firstStr(meta, 'courseCode', 'code', 'newCourseCode');
  const name = firstStr(meta, 'courseName');
  if (code && name) return `${code}, ${name}`;
  return code ?? name ?? str(meta, 'courseId');
}

/**
 * The course as context ("in CMPSC 464"): the code alone, since the API's
 * "CMPSC 464, Theory of Computation" is more than a table cell can share. A deleted course is
 * named by its id there, which is returned whole.
 */
function courseTag(related?: RelatedRecords | null, meta?: Metadata): string | null {
  const course = related?.course?.trim() ?? courseNamed(meta ?? null, null);
  if (!course) return null;
  const [code] = course.split(',');
  return code?.trim() || course;
}

/**
 * Actions whose metadata `title` is the assignment's, per the code that writes them. Group
 * sets, problems and comments record `title` too, so this is never read globally.
 */
const TITLE_IS_ASSIGNMENT = new Set([
  'DELETE_ASSIGNMENT',
  'CREATE_ASSIGNMENT',
  'DUPLICATE_ASSIGNMENT',
  'IMPORT_ASSIGNMENT',
  'LTI_DEEP_LINK_RETURNED',
  'LTI_DEEP_LINK_REMOVED',
]);

function assignmentNamed(
  meta: Metadata,
  related?: RelatedRecords | null,
  action?: string,
): string | null {
  return (
    related?.assignment?.trim() ||
    firstStr(meta, 'assignmentTitle', 'assignmentName') ||
    (action && TITLE_IS_ASSIGNMENT.has(action) ? str(meta, 'title') : null) ||
    str(meta, 'assignmentId')
  );
}

function problemNamed(meta: Metadata, related?: RelatedRecords | null): string | null {
  return (
    related?.problem?.trim() ||
    firstStr(meta, 'problemTitle', 'problemName') ||
    str(meta, 'problemId')
  );
}

/** "X in Y", skipping whichever half is missing. */
function inside(what: string | null, where: string | null): string | null {
  if (!what) return where;
  return where ? `${what} in ${where}` : what;
}

/** Actions whose object is not simply the record they point at: "Course grades for X", not "X". */
const OBJECT_BY_ACTION: Record<
  string,
  (meta: Metadata, related?: RelatedRecords | null) => string | null
> = {
  COURSE_GRADES_VIEWED: (m, r) => {
    const course = courseNamed(m, r);
    return course ? `Course grades for ${course}` : 'Course grades';
  },
  GRADES_EXPORTED: (m, r) => {
    const course = courseTag(r, m);
    return course ? `Grades for ${course}` : 'Grades';
  },
  VIEW_ASSIGNMENT_SUBMISSIONS: (m, r) => {
    const where = inside(assignmentNamed(m, r), courseTag(r, m));
    return where ? `Submissions for ${where}` : 'Assignment submissions';
  },
  VIEW_STUDENT_PROBLEM_GRADES: (m, r) => {
    const where = assignmentNamed(m, r);
    return where ? `Problem grades for ${where}` : 'Problem grades';
  },
  VIEW_ASSIGNMENT_PROBLEMS: (m, r) => {
    const where = assignmentNamed(m, r);
    return where ? `Problems in ${where}` : 'Assignment problems';
  },
  ASSIGNMENT_STATISTICS_VIEWED: (m, r) => {
    const where = inside(assignmentNamed(m, r), courseTag(r, m));
    return where ? `Statistics for ${where}` : 'Assignment statistics';
  },
  COURSE_STATISTICS_VIEWED: (m, r) => {
    const where = courseTag(r, m);
    return where ? `Course statistics for ${where}` : 'Course statistics';
  },
  ASSIGNMENT_SIMILARITY_VIEWED: (m, r) => {
    const where = inside(assignmentNamed(m, r), courseTag(r, m));
    return where ? `Similarity report for ${where}` : 'Similarity report';
  },
  VIEW_USERS: (m) => {
    const accounts = firstNum(m, 'accounts');
    return accounts > 0 ? `User list, ${plural(accounts, 'account')}` : 'User list';
  },
  ADMIN_LOGS_VIEWED: () => 'The activity log',
  ADMIN_LOGS_EXPORTED: () => 'The activity log',
  ADMIN_STATUS_VIEWED: () => 'System status',
  ADMIN_SUBMISSIONS_VIEWED: () => 'Every course’s submissions',
  SYSTEM_SETTINGS_VIEWED: () => 'System settings',
  COURSE_ROSTER_VIEWED: (m, r) => {
    const course = courseNamed(m, r);
    return course ? `Roster for ${course}` : 'Course roster';
  },
  USER_ADMIN_GRANTED: (m) => accountNamed(m),
  USER_ADMIN_REVOKED: (m) => accountNamed(m),
  ASSIGNMENT_GRADE_SYNC_UPDATED: (m, r) => {
    const where = assignmentNamed(m, r);
    return where ? `LMS grade sync for ${where}` : 'LMS grade sync';
  },
  LTI_GRADES_PUSH_REQUESTED: (m, r) => {
    const where = assignmentNamed(m, r);
    return where ? `Grades for ${where} to the LMS` : 'Grades to the LMS';
  },
  LTI_ROSTER_SYNCED: (m, r) => {
    const course = courseTag(r, m);
    return course ? `Roster for ${course}` : 'Roster';
  },
  PROBLEM_GRADE_CLEARED: (m, r) => {
    const where = inside(problemNamed(m, r), assignmentNamed(m, r));
    return where ? `Grade for ${where}` : 'Problem grade';
  },
  CREATE_COMMENT: (m, r) => {
    const where = inside(problemNamed(m, r), assignmentNamed(m, r));
    return where ? `Feedback on ${where}` : 'Feedback';
  },
  DELETE_COMMENT: (m, r) => {
    const where = inside(problemNamed(m, r), assignmentNamed(m, r));
    return where ? `Feedback on ${where}` : 'Feedback';
  },
  CHANGE_COURSE_ROLE: (m, r) => {
    const course = courseTag(r, m);
    return course ? `Course role in ${course}` : 'Course role';
  },
  UPDATE_ASSIGNMENT_AUDIENCE: (m, r) => {
    const where = assignmentNamed(m, r);
    return where ? `${where} audience` : 'Assignment audience';
  },
  UPDATE_ASSIGNMENT_PROBLEM_SETTINGS: (m, r) => {
    const where = inside(problemNamed(m, r), assignmentNamed(m, r));
    return where ? `${where} settings` : 'Assignment problem settings';
  },
  CREATE_ASSIGNMENT_OVERRIDE: (m, r) => overrideObject(m, r),
  UPDATE_ASSIGNMENT_OVERRIDE: (m, r) => overrideObject(m, r),
  DELETE_ASSIGNMENT_OVERRIDE: (m, r) => overrideObject(m, r),
  // The way in is the object: "Signed in | AFCT password". Blank on an old entry rather than
  // guessed; claiming a password sign-in that may have been an LMS launch would be false.
  LOGIN_SUCCESS: (m) => SIGN_IN_OBJECT[str(m, 'provider') ?? ''] ?? null,
  CLIENT_LOGIN: (m) => {
    const how = SIGN_IN_OBJECT[str(m, 'provider') ?? ''];
    return how ? `Desktop client, ${how.toLowerCase()}` : 'Desktop client';
  },
  LOGOUT: (m) => SIGN_OUT_OBJECT[str(m, 'provider') ?? ''] ?? null,
  CLIENT_LOGOUT: () => 'Desktop client session',
  CREATE_USER: (m) => accountNamed(m),
  UPDATE_USER: (m) => accountNamed(m),
  DELETE_USER: (m) => accountNamed(m),
  USER_SIGNUP: (m) => accountNamed(m),
  RESET_PASSWORD: (m) => {
    const who = firstStr(m, 'userEmail', 'email');
    return who ? `Password for ${who}` : 'Password';
  },
  CHANGE_PASSWORD: () => 'Own password',
  SET_PASSWORD: () => 'First password for the account',
  UNLOCK_ACCOUNT: (m) => firstStr(m, 'userEmail', 'email') ?? 'Account',
  CLEAR_RATE_LIMIT: (m) => {
    const ip = firstStr(m, 'ip', 'ipAddress');
    return ip ? `Login rate limit for ${ip}` : 'Login rate limit';
  },
  SYSTEM_SETTINGS_UPDATED: () => 'System settings',
  SYSTEM_UPDATE_REQUESTED: () => 'System update',
  SYSTEM_UPDATE_COMPLETED: () => 'System update',
  SYSTEM_UPDATE_ROLLED_BACK: () => 'System update',
  SYSTEM_UPDATE_FAILED: () => 'System update',
  SYSTEM_DOWNGRADE_REQUESTED: () => 'System downgrade',
  SYSTEM_BACKUP_REQUESTED: () => 'System backup',
  SYSTEM_BACKUP_DOWNLOADED: () => 'System backup',
  SYSTEM_RESTORE_POINT_DELETE_REQUESTED: () => 'Restore point',
  TEST_EMAIL_SENT: () => 'Test email',
  TLS_CERT_RESET: () => 'TLS certificate',
  ABANDONED_FILE_DELETED: () => 'Abandoned file',
  ABANDONED_FILES_PURGED: () => 'Abandoned files',
};

/** An assignment override names the assignment it belongs to, not itself. */
function overrideObject(meta: Metadata, related?: RelatedRecords | null): string {
  const where = assignmentNamed(meta, related);
  return where ? `${where} due-date override` : 'Assignment due-date override';
}

/** An account, by the address that identifies it. Never by anything secret. */
function accountNamed(meta: Metadata): string {
  const who = firstStr(meta, 'userEmail', 'email', 'targetEmail');
  return who ? `Account for ${who}` : 'Account';
}

/** The way in, as an object rather than as the fragment the old column used. */
const SIGN_IN_OBJECT: Record<string, string> = {
  credentials: 'AFCT password',
  'lti-launch': 'LMS launch',
  oidc: 'Institutional sign-in',
};

const SIGN_OUT_OBJECT: Record<string, string> = {
  credentials: 'Password session',
  'lti-launch': 'Session that came from an LMS',
  oidc: 'Institutional sign-in session',
};

/**
 * The object an entry is about: the most specific record it points at, a problem in an
 * assignment in a course. Covers create/update/delete/view without a case per action.
 */
export function objectPhrase(
  action: string,
  metadata: Metadata,
  related?: RelatedRecords | null,
): string | null {
  const own = OBJECT_BY_ACTION[action];
  if (own) return own(metadata, related);

  const problem = problemNamed(metadata, related);
  const assignment = assignmentNamed(metadata, related, action);
  const course = courseTag(related, metadata);

  // The action outranks specificity: UPDATE_ASSIGNMENT can carry a problem relation too, and
  // reporting that as a problem update names the wrong object. Only an action that names
  // nothing falls through to the rule below.
  const subject = /PROBLEM/.test(action)
    ? 'problem'
    : /ASSIGNMENT/.test(action)
      ? 'assignment'
      : /COURSE|ROSTER|ENROLL/.test(action)
        ? 'course'
        : null;

  if (subject === 'assignment' && assignment) return inside(assignment, course);
  if (subject === 'course' && (course || related?.course)) return courseNamed(metadata, related);

  if (problem) return inside(problem, assignment ?? course);
  if (assignment) return inside(assignment, course);

  // A group set names itself, and only where the action says it is one.
  if (/GROUP_SET/.test(action)) {
    // `deletedName` is all a deletion leaves; nothing can resolve the set afterwards.
    const set = firstStr(metadata, 'groupSetName', 'deletedName', 'name', 'title');
    const group = firstStr(metadata, 'groupName');
    if (group && set) return `${group} in ${set}`;
    if (set) return set;
  }

  // The course as the object rather than as context, so a course event reads with its title.
  if (/COURSE/.test(action)) return courseNamed(metadata, related);

  return course;
}

/**
 * The object, then what happened to it:
 *
 *     Course grades for CMPSC 464, Theory of Computation · 17 students
 *     Homework 2 in CMPSC 464 · Due date: Aug 27 to Sep 3
 *
 * {@link objectPhrase} names the thing, {@link activityDetail} says what happened; either can
 * be missing. `related` is optional, so historical entries and deleted records fall through to
 * metadata and then to ids.
 */
export function describeActivity(
  action: string,
  metadata: Metadata,
  related?: RelatedRecords | null,
): string | null {
  const object = objectPhrase(action, metadata, related);
  const detail = activityDetail(action, metadata);
  if (!object) return detail;
  return detail ? `${object}${SUMMARY_SEPARATOR}${detail}` : object;
}

/**
 * What happened to the object: a count, a state, a change, or why a request was refused.
 *
 * Still a switch because each action knows which of its metadata fields carry meaning; a
 * generic "first number in the object" reader would be confidently wrong. Metadata only,
 * since naming the object is {@link objectPhrase}'s job. Exported for its own tests.
 */
export function activityDetail(action: string, metadata: Metadata): string | null {
  switch (action) {
    // Updates that record old and new. The change itself is the whole point of the entry.
    case 'UPDATE_COURSE':
    case 'UPDATE_ASSIGNMENT':
    // Records its change the same way, so it reads "on to off" rather than just "updated".
    case 'ASSIGNMENT_GRADE_SYNC_UPDATED':
      return describeChanges(metadata);

    case 'PROBLEM_GRADE_UPDATED': {
      const before = metadata?.previousGrade;
      const after = metadata?.grade;
      if (after === undefined) return null;
      return before === null || before === undefined
        ? `graded ${String(after)}`
        : `${String(before)} to ${String(after)}`;
    }

    case 'PROBLEM_GRADE_CLEARED':
      return 'grade removed';

    // Enrolment, group sets, overrides: all record the standard shape now.
    case 'UPDATE_ASSIGNMENT_OVERRIDE':
    case 'UPDATE_GROUP_SET':
      return describeChanges(metadata);

    case 'DROP_FROM_COURSE':
    case 'REENROLL_IN_COURSE': {
      const via = str(metadata, 'via');
      if (via === 'LTI_ROSTER_SYNC') return 'from an LMS roster sync';
      return describeChanges(metadata);
    }

    case 'UPDATE_ASSIGNMENT_PROBLEM_SETTINGS':
      return describeChanges(metadata);

    case 'UPDATE_GROUP_SET_MEMBERSHIPS': {
      const assigned = num(metadata, 'assignedCount');
      const removed = num(metadata, 'removedCount');
      const parts: string[] = [];
      if (assigned > 0) parts.push(`${assigned} moved into a group`);
      if (removed > 0) parts.push(`${removed} taken out`);
      return parts.length > 0 ? parts.join(', ') : 'nothing changed';
    }

    case 'UPDATE_ASSIGNMENT_AUDIENCE': {
      if (metadata?.assignedToEveryone === true) return 'assigned to everyone';
      const count = num(metadata, 'assigneeCount');
      const kind = str(metadata, 'assigneeKind');
      const noun = kind === 'group' ? 'group' : 'student';
      return `assigned to ${count} ${count === 1 ? noun : `${noun}s`}`;
    }

    case 'CHANGE_COURSE_ROLE': {
      const from = str(metadata, 'previousRole');
      const to = str(metadata, 'newRole');
      return from && to ? `${from} to ${to}` : null;
    }

    case 'LTI_ROSTER_SYNCED':
      // The headline only. Who was added or dropped has an entry of its own, using the same
      // actions as a roster change made by hand, so it can be searched and filtered like one.
      return counts(metadata);

    case 'ENROLL_USER': {
      const via = str(metadata, 'via');
      return via === 'LTI_ROSTER_SYNC' ? 'from an LMS roster sync' : null;
    }

    case 'LTI_PLATFORM_REGISTERED':
    case 'LTI_PLATFORM_REMOVED': {
      const issuer = str(metadata, 'issuer');
      const client = str(metadata, 'clientId');
      // Whether the LMS registered itself or somebody typed it in, because the two are
      // investigated differently when a registration has to be explained later.
      const automatic = str(metadata, 'via') === 'dynamic-registration' ? ', automatic' : '';
      return issuer ? `${issuer}${client ? `, client ${client}` : ''}${automatic}` : null;
    }

    case 'SUBMISSION_AUTOGRADE_SKIPPED':
      // Why the grade did not move, which is the whole content of the entry.
      return str(metadata, 'reason');

    case 'SUBMISSION_STALE_DISCARDED':
      return 'the submission was reclaimed while it was being graded';

    case 'LTI_DYNAMIC_REGISTRATION_FAILED':
      // Why it stopped. Every value is one of the fixed reasons the registration code returns.
      return str(metadata, 'reason');

    case 'LTI_COURSE_LINKED':
    case 'LTI_COURSE_UNLINKED': {
      const context = str(metadata, 'contextId');
      return context ? `LMS course ${context}` : null;
    }

    case 'LTI_LAUNCH_DENIED': {
      const reason = str(metadata, 'reason');
      const observed = metadata?.observedClaims as Record<string, unknown> | null | undefined;
      const issuer = observed ? str(observed, 'issuer') : null;
      if (!reason) return null;
      // The claimed issuer is what an administrator compares against the registration, so it
      // earns its place next to the reason.
      return issuer ? `${reason}, claimed issuer ${issuer}` : reason;
    }

    case 'IDENTITY_LINKED': {
      const via = str(metadata, 'via');
      const kind = str(metadata, 'kind');
      const created = metadata?.accountCreated === true;
      const how = via ? (VIA[via] ?? via) : null;
      const parts = [kind, how].filter(Boolean).join(', ');
      return parts ? `${parts}${created ? ', new account' : ''}` : null;
    }

    // The way in is the OBJECT now ("Signed in | AFCT password"), so all that is left here is
    // the one thing that qualifies it.
    case 'LOGIN_SUCCESS':
    case 'CLIENT_LOGIN':
      return metadata?.temporaryPasswordLogin === true ? 'temporary password' : null;

    // Which session ended is the object; nothing qualifies it. A session started before the
    // provider was recorded has no object either, and the verb alone still says what happened.
    case 'LOGOUT':
    case 'CLIENT_LOGOUT':
      return null;

    case 'LTI_DEEP_LINK_RETURNED': {
      // Which assignment the LMS link now opens, which is the whole of what happened.
      const assignment = str(metadata, 'assignmentTitle');
      return assignment ? `linked to ${assignment}` : null;
    }

    case 'LTI_DEEP_LINK_REMOVED': {
      // Names the LMS as well as the assignment: the same assignment can be linked in more
      // than one LMS course, so "unlinked X" alone would not say which link went.
      const assignment = str(metadata, 'assignmentTitle');
      const platform = str(metadata, 'platform');
      if (assignment && platform) return `${assignment} is no longer marked as in ${platform}`;
      return assignment ? `${assignment} is no longer marked as in an LMS` : null;
    }

    case 'IDENTITY_LINK_DENIED':
      return str(metadata, 'reason');

    case 'USER_IDENTITY_REASSIGNED': {
      // Both addresses, because the point of the entry is which account an LMS launch now
      // signs somebody in as. One address alone would not say what changed.
      const from = str(metadata, 'fromUserEmail');
      const to = str(metadata, 'targetUserEmail');
      if (from && to) return `LMS sign-in moved from ${from} to ${to}`;
      return 'an LMS sign-in was moved to another account';
    }

    case 'IDENTITY_UNLINKED': {
      // Entries written before the issuer was recorded have only the two ids, and say the
      // plain fact rather than nothing: somebody's way in was removed either way.
      const issuer = str(metadata, 'issuer');
      const kind = str(metadata, 'kind');
      const what = [kind, issuer].filter(Boolean).join(' at ');
      return what ? `${what} removed` : 'a way in was removed';
    }

    /**
     * Somebody looked at a student's work.
     *
     * These carry the most weight of anything here. Under FERPA the log is the disclosure
     * record, and "a member of staff opened something" is weak evidence next to "a member of
     * staff opened one student's submissions". None of these names the student: the row already
     * points at them through `targetUserId`, and putting a name in a column that is read over
     * somebody's shoulder is its own disclosure. Scope is what the summary adds.
     */
    case 'VIEW_STUDENT_SUBMISSION':
    case 'VIEW_STUDENT_REVIEW_DATA': {
      const source = str(metadata, 'source');
      const where = source ? (VIEW_SOURCE[source] ?? source) : null;
      return where ? `one student, from ${where}` : 'one student';
    }

    case 'VIEW_ASSIGNMENT_SUBMISSIONS': {
      const student = firstStr(metadata, 'viewedStudentId', 'studentId');
      return student ? "one student's submissions" : 'the whole assignment';
    }

    case 'VIEW_STUDENT_PROBLEM_GRADES': {
      const count = firstNum(metadata, 'problemCount', 'length');
      return count > 0 ? `${plural(count, 'problem grade')}, one student` : 'one student';
    }

    // Which course this was is the object now, so all that is left here is the scale of it.
    case 'COURSE_GRADES_VIEWED': {
      const students = firstNum(metadata, 'studentCount', 'total');
      return students > 0 ? plural(students, 'student') : null;
    }

    case 'ASSIGNMENT_SIMILARITY_VIEWED': {
      const groups = firstNum(metadata, 'matchGroups');
      return groups > 0 ? plural(groups, 'match group') : null;
    }

    case 'GRADES_EXPORTED': {
      const parts = [
        firstNum(metadata, 'studentCount') > 0
          ? plural(firstNum(metadata, 'studentCount'), 'student')
          : null,
        metadata?.wholeGradebook === true
          ? 'whole gradebook'
          : firstNum(metadata, 'assignmentCount') > 0
            ? plural(firstNum(metadata, 'assignmentCount'), 'assignment')
            : null,
        str(metadata, 'platform') ? `for ${str(metadata, 'platform')}` : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : null;
    }

    case 'ASSIGNMENT_STATISTICS_VIEWED': {
      const people = firstNum(metadata, 'participantCount');
      return people > 0 ? plural(people, 'participant') : null;
    }

    case 'COURSE_STATISTICS_VIEWED': {
      // Same shape as the line above, one level wider: how many students the figures were
      // about, and across how much work. Study data, so the wording stays put.
      const people = firstNum(metadata, 'studentCount');
      const assignments = firstNum(metadata, 'assignments');
      const parts = [
        people > 0 ? plural(people, 'student') : null,
        assignments > 0 ? plural(assignments, 'assignment') : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : null;
    }

    // Every file AFCT serves, and the answer is always the same one: which file. The name the
    // person who uploaded it chose comes first, because the stored name is a uuid.
    //
    // Submission files were missing from this list, so the entry that records a member of
    // staff opening a student's work said only VIEW SUBMISSION FILE. Under FERPA that entry is
    // a disclosure record, and "somebody looked at a file" is not one.
    case 'VIEW_PROBLEM_FILE':
    case 'VIEW_SOLUTION_FILE':
    case 'DOWNLOAD_SOLUTION_FILE':
    case 'VIEW_SUBMISSION_FILE':
    case 'DOWNLOAD_SUBMISSION_FILE':
      return firstStr(metadata, 'originalFileName', 'fileName', 'file');

    // Grades and attempts, where the number is the entry.
    case 'GROUP_PROBLEM_GRADE_UPDATED': {
      const group = firstStr(metadata, 'groupName', 'name');
      const grade = metadata?.grade;
      const members = Array.isArray(metadata?.memberIds) ? metadata.memberIds.length : 0;
      const head = [
        group ? `${group}` : null,
        grade === undefined ? null : `graded ${String(grade)}`,
        members > 0 ? plural(members, 'member') : null,
      ]
        .filter(Boolean)
        .join(', ');
      // Worth saying out loud: this one overwrote marks that were not all the same, so
      // somebody's individual grade changed as a side effect of grading the group.
      return metadata?.overwroteDiffering === true
        ? `${head}, replaced differing marks`
        : head || null;
    }

    case 'GRANT_EXTRA_SUBMISSIONS':
    case 'REVOKE_EXTRA_SUBMISSIONS': {
      const extra = firstNum(metadata, 'extraSubmissions');
      const total = firstNum(metadata, 'totalExtraSubmissions');
      const who = str(metadata, 'targetType') === 'GROUP' ? 'a group' : 'one student';
      const change = action === 'GRANT_EXTRA_SUBMISSIONS' ? `+${extra}` : `-${extra}`;
      const reason = str(metadata, 'reason');
      const head = `${change} ${extra === 1 ? 'attempt' : 'attempts'} for ${who}${
        total > 0 ? ` (${total} in total)` : ''
      }`;
      return reason ? `${head}: ${reason}` : head;
    }

    case 'SUBMISSION_RERUN': {
      const status = str(metadata, 'status');
      return status ? `re-run, now ${status.toLowerCase()}` : 're-run';
    }

    case 'COURSE_SUBMISSIONS_RERUN': {
      const count = firstNum(metadata, 'count');
      return count > 0 ? `${plural(count, 'submission')} re-run` : 'nothing to re-run';
    }

    // Enrolment done in bulk, or by the student themselves.
    case 'BULK_ENROLL_USERS':
      return (
        tally([
          [firstNum(metadata, 'enrolledCount', 'count'), 'enrolled'],
          [firstNum(metadata, 'reEnrolledCount'), 're-enrolled'],
        ]) ?? 'nobody enrolled'
      );

    case 'REMOVE_FROM_COURSE': {
      const count = firstNum(metadata, 'count');
      return count > 1 ? `${plural(count, 'person', 'people')} removed` : null;
    }

    case 'COURSE_JOINED': {
      const course = courseNamed(metadata);
      const role = str(metadata, 'role');
      return [course, role ? `as ${role.toLowerCase()}` : null].filter(Boolean).join(', ') || null;
    }

    // Accounts. Whose account, and what about it changed.
    case 'CREATE_USER':
      return firstStr(metadata, 'createdUserEmail', 'email');

    case 'DELETE_USER':
      return firstStr(metadata, 'deletedUserEmail', 'deletedUserName');

    case 'UPDATE_USER': {
      const changes = describeChanges(metadata);
      if (changes) return changes;
      return metadata?.avatarChanged === true ? 'profile photo' : null;
    }

    case 'BULK_CREATE_USERS':
      return (
        tally([
          [firstNum(metadata, 'createdCount'), 'created'],
          [firstNum(metadata, 'failedCount'), 'failed'],
        ]) ?? 'nothing to create'
      );

    case 'USER_SIGNUP':
      return firstStr(metadata, 'email', 'normalizedEmail');

    case 'RESET_PASSWORD':
    case 'RESET_STUDENT_PASSWORD':
      return metadata?.temporaryPassword === true ? 'temporary password set' : null;

    case 'CHANGE_PASSWORD':
      return metadata?.wasTemporaryPassword === true ? 'replaced a temporary password' : null;

    // A first password on an account that had none, which is a way in being added rather than
    // one being changed. Worth saying plainly, because that is the difference somebody
    // reviewing this log is looking for.
    case 'SET_PASSWORD':
      return 'first password, set by the account holder';

    case 'SET_PASSWORD_DENIED':
      return 'this site does not allow it';

    case 'PASSWORD_RESET_REQUESTED':
      // Which of the two messages went out. An account with no password gets an explanation
      // rather than a link, and reading that as "a link was sent" would be wrong.
      if (metadata?.kind === 'explanation') return 'no password to reset, told how to sign in';
      // Whether a link was actually made, which is what separates a real request from a probe
      // at an address with no account.
      return metadata?.queued === true || metadata?.sent === true
        ? 'a link was sent'
        : 'no account, nothing sent';

    case 'UNLOCK_ACCOUNT':
      return metadata?.wasLocked === true ? 'was locked out' : 'was not locked';

    case 'CLEAR_RATE_LIMIT': {
      const scope = str(metadata, 'scope');
      const target = firstStr(metadata, 'targetIp', 'ip');
      const attempts = firstNum(metadata, 'attempts', 'attemptsWhileRestricted');
      return (
        [scope, target, attempts > 0 ? `after ${plural(attempts, 'attempt')}` : null]
          .filter(Boolean)
          .join(', ') || null
      );
    }

    case 'PROFILE_UPDATED': {
      const changed = [
        firstStr(metadata, 'firstName', 'userFirstName') ? 'name' : null,
        str(metadata, 'timezone') ? 'time zone' : null,
        metadata?.avatarUpdated === true ? 'photo' : null,
        metadata?.avatarDeleted === true ? 'photo removed' : null,
      ].filter(Boolean);
      return changed.length > 0 ? changed.join(', ') : null;
    }

    case 'CLIENT_TOKEN_ISSUED':
    case 'CLIENT_TOKEN_REVOKED':
      return str(metadata, 'label');

    // Courses and their contents.
    // The object names the course; nothing else about a creation is worth a second phrase.
    case 'CREATE_COURSE':
      return null;

    case 'DELETE_COURSE': {
      // What went with it. A deleted course takes assignments, problems and enrolments with it,
      // and the size of that is the thing somebody asking about it wants to know.
      const took = tally([
        [firstNum(metadata, 'assignmentCount'), 'assignments'],
        [firstNum(metadata, 'problemCount'), 'problems'],
        [firstNum(metadata, 'studentCount'), 'students'],
      ]);
      return took;
    }

    case 'COURSE_DUPLICATED': {
      const mode = firstStr(metadata, 'copyMode', 'mode');
      return (
        [courseNamed(metadata), mode ? `copied ${mode.toLowerCase()}` : null]
          .filter(Boolean)
          .join(', ') || null
      );
    }

    case 'CREATE_ASSIGNMENT': {
      if (metadata?.assignedToEveryone === true) return 'assigned to everyone';
      const count = firstNum(metadata, 'assigneeCount');
      return count > 0 ? `assigned to ${plural(count, 'student')}` : null;
    }

    /**
     * The object names all of these now, and it names them better: it resolves the current
     * title, falls back to what the deletion recorded, and adds the course or assignment they
     * sat in. Returning the title here as well printed it twice.
     */
    case 'DELETE_ASSIGNMENT':
    case 'REMOVE_ASSIGNMENT_PROBLEM':
    case 'DELETE_PROBLEM':
    case 'CREATE_PROBLEM':
      return null;

    case 'UPDATE_PROBLEM':
      return metadata?.fileUpdated === true ? 'solution file replaced' : null;

    case 'DUPLICATE_PROBLEM':
    case 'IMPORT_PROBLEM':
      return null;

    case 'DUPLICATE_ASSIGNMENT':
    case 'IMPORT_ASSIGNMENT': {
      const title = firstStr(metadata, 'title');
      const problems = firstNum(metadata, 'problemCount');
      return (
        [title, problems > 0 ? plural(problems, 'problem') : null].filter(Boolean).join(', ') ||
        null
      );
    }

    case 'ADD_ASSIGNMENT_PROBLEMS': {
      const added = Array.isArray(metadata?.addedProblemIds) ? metadata.addedProblemIds.length : 0;
      const withWork = firstNum(metadata, 'linksWithSubmissions');
      return (
        [
          added > 0 ? `${plural(added, 'problem')} added` : null,
          // Adding to an assignment students have already submitted against is worth flagging.
          withWork > 0 ? `${plural(withWork, 'already has', 'already have')} submissions` : null,
        ]
          .filter(Boolean)
          .join(', ') || null
      );
    }

    case 'CHANGE_ASSIGNMENT_TYPE':
      return metadata?.isGroup === true ? 'to a group assignment' : 'to an individual assignment';

    case 'CREATE_ASSIGNMENT_OVERRIDE':
    case 'DELETE_ASSIGNMENT_OVERRIDE': {
      const target = str(metadata, 'targetType');
      const due = firstStr(metadata, 'dueDate', 'previousDueDate');
      return (
        [target ? `for a ${target.toLowerCase()}` : null, due ? `due ${due}` : null]
          .filter(Boolean)
          .join(', ') || null
      );
    }

    // Group sets.
    case 'CREATE_GROUP_SET': {
      const name = str(metadata, 'name');
      const groups = firstNum(metadata, 'initialGroupCount');
      return [name, groups > 0 ? plural(groups, 'group') : null].filter(Boolean).join(', ') || null;
    }

    // Named by the object, including the name a deletion recorded on its way out.
    case 'DELETE_GROUP_SET':
    case 'DELETE_GROUP_SET_GROUP':
    case 'CREATE_GROUP_SET_GROUP':
      return null;

    case 'UPDATE_GROUP_SET_GROUP': {
      const from = str(metadata, 'previousName');
      const to = str(metadata, 'name');
      return from && to ? `${from} to ${to}` : (to ?? null);
    }

    case 'DUPLICATE_GROUP_SET': {
      const name = str(metadata, 'name');
      const members = firstNum(metadata, 'copiedMemberCount');
      return (
        [name, members > 0 ? `${plural(members, 'membership')} copied` : null]
          .filter(Boolean)
          .join(', ') || null
      );
    }

    // Feedback on somebody's work.
    case 'CREATE_COMMENT':
    case 'DELETE_COMMENT':
      return metadata?.aboutGroupId ? 'about a group' : 'about one student';

    // The system itself.
    case 'SYSTEM_SETTINGS_UPDATED': {
      const changes = describeChanges(metadata);
      if (changes) return changes;
      // Secrets are recorded as whether they moved, never as values.
      const secrets = [
        metadata?.smtpPasswordUpdated === true ? 'mail password set' : null,
        metadata?.smtpPasswordCleared === true ? 'mail password cleared' : null,
        metadata?.hcaptchaSecretUpdated === true ? 'captcha secret set' : null,
        metadata?.hcaptchaSecretCleared === true ? 'captcha secret cleared' : null,
      ].filter(Boolean);
      return secrets.length > 0 ? secrets.join(', ') : null;
    }

    case 'SYSTEM_UPDATE_REQUESTED':
    case 'SYSTEM_DOWNGRADE_REQUESTED': {
      const from = str(metadata, 'fromTag');
      const to = str(metadata, 'tag');
      const forced = metadata?.forced === true || metadata?.force === true;
      const head = from && to ? `${from} to ${to}` : (to ?? null);
      return head ? `${head}${forced ? ', forced' : ''}` : null;
    }

    case 'SYSTEM_UPDATER_SELF_UPDATE_REQUESTED':
      return str(metadata, 'tag');

    /**
     * How a finished run ended. `SYSTEM_UPDATE_FAILED` is not here: it ends in _FAILED, so the
     * pattern at the bottom already reports its reason.
     */
    case 'SYSTEM_UPDATE_COMPLETED':
    case 'SYSTEM_UPDATE_ROLLED_BACK': {
      const from = str(metadata, 'fromTag');
      const to = str(metadata, 'toTag');
      if (action === 'SYSTEM_UPDATE_ROLLED_BACK') {
        // The version it ended on is the one an administrator needs, and on a rollback that is
        // the one it started from.
        return from ? `${to ? `${to} failed, ` : ''}back on ${from}` : 'put back as it was';
      }
      if (from && to) return `${from} to ${to}`;
      return to ? `now on ${to}` : null;
    }

    /**
     * The submission pipeline, whose entries are the busiest thing in the log.
     *
     * The object (the problem, and the assignment it sits in) is supplied above, so each of
     * these adds only what distinguishes it: the file, the state it ended in, or the reason it
     * was refused. Written as one group because they share their metadata shape and reading
     * them together is how anybody debugs a submission that did not arrive.
     */
    case 'SUBMISSION_CREATED': {
      const file = firstStr(metadata, 'originalFileName', 'fileName');
      const state = firstStr(metadata, 'status');
      return [file, state?.toLowerCase()].filter(Boolean).join(', ') || null;
    }

    /**
     * What the autograder decided. The mark and the verdict, because "10/10" and "correct" are
     * not the same statement: a zero-point problem can be correct, and a partial mark on a
     * problem graded by cases is neither.
     */
    case 'SUBMISSION_AUTOGRADED': {
      const grade = metadata?.grade;
      const outOf = firstNum(metadata, 'maxPoints', 'maxGrade');
      const correct = metadata?.correct;
      const mark =
        grade === undefined || grade === null
          ? null
          : outOf > 0
            ? `${String(grade)}/${outOf}`
            : String(grade);
      const verdict = correct === true ? 'correct' : correct === false ? 'incorrect' : null;
      return [mark, verdict].filter(Boolean).join(', ') || null;
    }

    /**
     * The reads that exist to record a disclosure. Each says how much was seen, and the log
     * view says what it was narrowed to, because "the log, filtered to one student" is a
     * different act from browsing it.
     */
    case 'ADMIN_LOGS_VIEWED': {
      const matched = firstNum(metadata, 'matched');
      const about = Array.isArray(metadata?.aboutUserIds)
        ? (metadata.aboutUserIds as unknown[]).length
        : 0;
      const parts = [
        about > 0 ? `narrowed to ${plural(about, 'account')}` : null,
        str(metadata, 'search') ? `search "${str(metadata, 'search')}"` : null,
        matched > 0 ? `${matched} matching` : null,
      ].filter(Boolean);
      return parts.join(', ') || null;
    }

    case 'ADMIN_LOGS_EXPORTED': {
      const rows = firstNum(metadata, 'rows');
      const fields = Array.isArray(metadata?.fields) ? (metadata.fields as unknown[]).length : 0;
      return (
        [
          rows > 0 ? plural(rows, 'entry', 'entries') : null,
          fields > 0 ? plural(fields, 'field') : null,
          metadata?.truncated === true ? 'truncated at the export limit' : null,
        ]
          .filter(Boolean)
          .join(', ') || null
      );
    }

    case 'COURSE_ROSTER_VIEWED': {
      const size = firstNum(metadata, 'rosterSize');
      return size > 0 ? plural(size, 'person', 'people') : null;
    }

    case 'LTI_GRADES_PUSH_REQUESTED': {
      const queued = firstNum(metadata, 'queued');
      const scope = str(metadata, 'scope') === 'student' ? 'one student' : null;
      return [scope, queued > 0 ? `${plural(queued, 'grade')} queued` : 'nothing to send']
        .filter(Boolean)
        .join(', ');
    }

    /**
     * Where a student came from and where they went. A move without the group they left is
     * the half that cannot answer whose work a group grade used to land on.
     */
    case 'GROUP_MEMBERSHIP_ASSIGNED':
    case 'GROUP_MEMBERSHIP_REMOVED': {
      const from = str(metadata, 'fromGroupId');
      const to = str(metadata, 'toGroupId');
      const move =
        from && to ? `${from} to ${to}` : to ? `into ${to}` : from ? `out of ${from}` : null;
      return ['one student', move].filter(Boolean).join(', ');
    }

    case 'SUBMISSION_FILE_RECEIVED':
    case 'SUBMISSION_FILE_STORED':
      return firstStr(metadata, 'originalFileName', 'fileName');

    case 'SUBMISSION_LIMIT_REACHED': {
      const limit = firstNum(metadata, 'limit', 'maxAttempts');
      return limit > 0 ? `submission limit reached (${limit})` : 'submission limit reached';
    }

    case 'SUBMISSION_RATE_LIMITED':
      return 'resubmitted too quickly';

    case 'SUBMISSION_REJECTED_NOT_OPEN':
      return 'the assignment is not open yet';

    case 'SUBMISSION_REJECTED_LATE':
      return 'late submissions are not allowed';

    case 'SUBMISSION_REJECTED_LATE_CUTOFF':
      return 'the late cutoff has passed';

    case 'SUBMISSION_REJECTED_ARCHIVED':
      return 'the course is archived';

    case 'SUBMISSION_UNPUBLISHED_ASSIGNMENT':
      return 'the assignment is unpublished';

    case 'SUBMISSION_NOT_ASSIGNED':
      return 'this work is not assigned to that student';

    case 'SUBMISSION_FILE_TOO_LARGE': {
      const file = firstStr(metadata, 'originalFileName', 'fileName');
      return [file, 'over the upload limit'].filter(Boolean).join(', ');
    }

    case 'SUBMISSION_FAILED_PERMANENTLY':
      return 'gave up after the maximum grading attempts';

    case 'SYSTEM_RESTORE_POINT_DELETE_REQUESTED':
      return firstStr(metadata, 'version', 'restorePoint');

    case 'SYSTEM_BACKUP_DOWNLOADED':
      return str(metadata, 'file');

    case 'TEST_EMAIL_SENT':
      return firstStr(metadata, 'recipient', 'to');

    case 'TLS_CERT_RESET':
      return str(metadata, 'revertedTo');

    case 'ABANDONED_FILE_DELETED':
      return str(metadata, 'fileName');

    // Not matched by the failure pattern below (it ends in _STRUCTURE) but it is one.
    case 'PROBLEM_INVALID_FILE_STRUCTURE':
      return str(metadata, 'error');

    default:
      // The two failure actions with their own cases add context to the reason.
      return FAILURE.test(action)
        ? (str(metadata, 'reason') ?? str(metadata, 'error') ?? str(metadata, 'message'))
        : null;
  }
}

/** A field worth showing on its own line, in the order somebody reads them. */
type DetailRow = { label: string; value: string };

/** Words for the keys that appear in metadata, so a reader is not parsing camelCase. */
const FIELD_LABELS: Record<string, string> = {
  accountsCreated: 'New accounts',
  identitiesLinked: 'Sign-ins connected',
  clientId: 'Client ID',
  deploymentId: 'Deployment ID',
  contextId: 'LMS course',
  platformId: 'Platform',
  targetUserId: 'About user',
  observedClaims: 'Claimed by the token',
  linkId: 'Link',
  identityId: 'Sign-in method',
};

const label = (key: string) =>
  FIELD_LABELS[key] ??
  // camelCase to sentence case: "dueDate" becomes "Due date", not "Due Date". Explicit labels
  // above are left alone, so "Client ID" keeps its capitals.
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

const render = (value: unknown): string => {
  if (value === null || value === undefined) return 'none';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${label(k)}: ${render(v)}`)
      .join(', ');
  }
  return String(value);
};

/**
 * Separator between the object and what happened to it. Exported because it is punctuation, not
 * a word: callers split on it and mark the dot `aria-hidden`, as the dashboard does with its
 * "2 courses · 5 assignments" row. See {@link summaryParts}.
 */
export const SUMMARY_SEPARATOR = ' · ';

/** The summary split so a cell can hide the separator from assistive tech. */
export function summaryParts(summary: string | null): string[] {
  return summary ? summary.split(SUMMARY_SEPARATOR) : [];
}

/**
 * One line for the detail view: "Charles Xavier · Signed in · AFCT password". The same three
 * parts the table shows, so landing here from a row does not mean learning new wording.
 *
 * The subject is the entry's actor, never `metadata.userName`: those differ whenever an action
 * is done TO somebody, and naming the target as the actor would be false. No actor, no subject.
 */
export function describeActivitySentence(entry: {
  action: string;
  metadata?: Metadata;
  userDisplayName?: string | null;
  related?: RelatedRecords | null;
}): string | null {
  const summary = describeActivity(entry.action, entry.metadata, entry.related);
  const parts = [entry.userDisplayName?.trim() || null, actionLabel(entry.action), summary];
  return parts.filter(Boolean).join(SUMMARY_SEPARATOR) || null;
}

/**
 * An activity-log entry as something a person can read, in place of the raw row as JSON.
 *
 * Ordered: what happened, then who and where, then the rest. Identifiers stay, since support
 * questions turn on them, but below the parts that answer the question at a glance.
 */
export function formatActivityDetails(entry: {
  action: string;
  /** The actor, for the sentence at the top. See describeActivitySentence. */
  userDisplayName?: string | null;
  timestamp?: string | Date | null;
  severity?: string | null;
  category?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Metadata;
  related?: RelatedRecords | null;
}): string {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  // A sentence rather than the column's fragment: under a heading of its own, "with an AFCT
  // password" has no subject and no verb.
  const summary = describeActivitySentence({
    action: entry.action,
    metadata: meta,
    userDisplayName: entry.userDisplayName,
    related: entry.related,
  });

  const head: DetailRow[] = [
    { label: 'Action', value: entry.action.replace(/_/g, ' ') },
    ...(entry.timestamp
      ? [{ label: 'When', value: new Date(entry.timestamp).toLocaleString() }]
      : []),
    ...(entry.severity ? [{ label: 'Severity', value: entry.severity }] : []),
    ...(entry.category ? [{ label: 'Category', value: entry.category }] : []),
  ];

  // The person and place, pulled out of metadata because they answer "who and where" and
  // otherwise sit buried among identifiers.
  const whoKeys = ['userName', 'userEmail', 'courseName', 'courseCode'];
  const who: DetailRow[] = whoKeys
    .filter((key) => meta[key] !== undefined && meta[key] !== null)
    .map((key) => ({ label: label(key), value: render(meta[key]) }));

  if (entry.ipAddress) who.push({ label: 'IP address', value: entry.ipAddress });
  // Long, and rarely the answer, but it is audit data and the view being replaced showed it.
  // Trimmed rather than dropped: the readable part is at the front.
  if (entry.userAgent) {
    who.push({
      label: 'Browser',
      value: entry.userAgent.length > 80 ? `${entry.userAgent.slice(0, 80)}...` : entry.userAgent,
    });
  }

  /**
   * What the entry is about.
   *
   * These live in columns on the row rather than in metadata, so they were simply absent from
   * this view: somebody reading an entry about a grade could not see which assignment it was
   * for without going and looking the id up. Named, because "Course ID: cmr7x2..." is not an
   * answer to anything.
   */
  const about: DetailRow[] = (
    [
      ['Course', entry.related?.course],
      ['Assignment', entry.related?.assignment],
      ['Problem', entry.related?.problem],
      ['Submission', entry.related?.submission],
    ] as const
  )
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .map(([label, value]) => ({ label, value: value as string }));

  const rest: DetailRow[] = Object.entries(meta)
    .filter(([key]) => !whoKeys.includes(key) && !['ipAddress', 'userAgent'].includes(key))
    .map(([key, value]) => ({ label: label(key), value: render(value) }));

  const width = Math.max(...[...head, ...who, ...about, ...rest].map((r) => r.label.length), 0);
  const block = (rows: DetailRow[]) =>
    rows.map((r) => `${r.label.padEnd(width)}  ${r.value}`).join('\n');

  const sections = [
    summary ? `What happened\n${summary}` : null,
    block(head),
    who.length > 0 ? block(who) : null,
    // Above the raw metadata: what the entry is about is read far more often than the fields
    // the action happened to record.
    about.length > 0 ? `About\n${block(about)}` : null,
    rest.length > 0 ? `Details\n${block(rest)}` : null,
  ].filter(Boolean);

  return sections.join('\n\n');
}
