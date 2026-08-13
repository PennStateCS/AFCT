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

/** How somebody signed in, by the provider id NextAuth reports. */
const SIGN_IN: Record<string, string> = {
  credentials: 'with an AFCT password',
  'lti-launch': 'from an LMS',
  oidc: 'with institutional sign-in',
};

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
    .map(([field, change]) => `${label(field)}: ${shorten(change.from)} to ${shorten(change.to)}`)
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

/** Course code and name, however the call site happened to spell them. */
function courseNamed(meta: Metadata): string | null {
  const code = firstStr(meta, 'courseCode', 'code', 'newCourseCode');
  const name = firstStr(meta, 'courseName', 'name');
  if (code && name) return `${code}, ${name}`;
  return code ?? name;
}

export function describeActivity(action: string, metadata: Metadata): string | null {
  switch (action) {
    // Updates that record old and new. The change itself is the whole point of the entry.
    case 'UPDATE_COURSE':
    case 'UPDATE_ASSIGNMENT':
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
      return issuer ? `${issuer}${client ? `, client ${client}` : ''}` : null;
    }

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

    case 'LOGIN_SUCCESS':
    case 'CLIENT_LOGIN': {
      // How somebody got in. The rows are otherwise identical, and "signed in from an LMS"
      // against "signed in with a password" is the difference somebody is looking for.
      const how = SIGN_IN[str(metadata, 'provider') ?? ''] ?? null;
      const temporary = metadata?.temporaryPasswordLogin === true;
      if (!how) return temporary ? 'with a temporary password' : null;
      return temporary ? `${how}, temporary password` : how;
    }

    case 'LTI_DEEP_LINK_RETURNED': {
      // Which assignment the LMS link now opens, which is the whole of what happened.
      const assignment = str(metadata, 'assignmentTitle');
      return assignment ? `linked to ${assignment}` : null;
    }

    case 'IDENTITY_LINK_DENIED':
      return str(metadata, 'reason');

    case 'IDENTITY_UNLINKED':
      return str(metadata, 'issuer');

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

    case 'COURSE_GRADES_VIEWED': {
      const students = firstNum(metadata, 'studentCount', 'total');
      return students > 0 ? plural(students, 'student') : null;
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

    case 'VIEW_PROBLEM_FILE':
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
      const change =
        action === 'GRANT_EXTRA_SUBMISSIONS' ? `+${extra}` : `-${extra}`;
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

    case 'PASSWORD_RESET_REQUESTED':
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
    case 'CREATE_COURSE':
      return courseNamed(metadata);

    case 'DELETE_COURSE': {
      // What went with it. A deleted course takes assignments, problems and enrolments with it,
      // and the size of that is the thing somebody asking about it wants to know.
      const took = tally([
        [firstNum(metadata, 'assignmentCount'), 'assignments'],
        [firstNum(metadata, 'problemCount'), 'problems'],
        [firstNum(metadata, 'studentCount'), 'students'],
      ]);
      return [courseNamed(metadata), took ? `with ${took}` : null].filter(Boolean).join(', ') || null;
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
      if (metadata?.assignedToEveryone === true) return 'for everyone';
      const count = firstNum(metadata, 'assigneeCount');
      return count > 0 ? `for ${plural(count, 'assignee')}` : null;
    }

    case 'DELETE_ASSIGNMENT':
    case 'REMOVE_ASSIGNMENT_PROBLEM':
    case 'DELETE_PROBLEM':
    case 'CREATE_PROBLEM':
      return firstStr(metadata, 'problemTitle', 'title');

    case 'UPDATE_PROBLEM': {
      const title = firstStr(metadata, 'problemTitle', 'title');
      const file = metadata?.fileUpdated === true ? 'file replaced' : null;
      return [title, file].filter(Boolean).join(', ') || null;
    }

    case 'DUPLICATE_PROBLEM':
    case 'IMPORT_PROBLEM':
      return firstStr(metadata, 'title');

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
      return (
        [name, groups > 0 ? plural(groups, 'group') : null].filter(Boolean).join(', ') || null
      );
    }

    case 'DELETE_GROUP_SET':
    case 'DELETE_GROUP_SET_GROUP':
      return firstStr(metadata, 'deletedName', 'name');

    case 'CREATE_GROUP_SET_GROUP':
      return str(metadata, 'name');

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
 * An activity-log entry as something a person can read.
 *
 * Replaces handing the raw row to a viewer as JSON. The order is deliberate: what happened
 * first, then who and where, then the rest. Identifiers stay, because support questions turn on
 * them, but they sit below the things that answer the question at a glance.
 */
export function formatActivityDetails(entry: {
  action: string;
  timestamp?: string | Date | null;
  severity?: string | null;
  category?: string | null;
  ipAddress?: string | null;
  metadata?: Metadata;
}): string {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const summary = describeActivity(entry.action, meta);

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

  const rest: DetailRow[] = Object.entries(meta)
    .filter(([key]) => !whoKeys.includes(key) && !['ipAddress', 'userAgent'].includes(key))
    .map(([key, value]) => ({ label: label(key), value: render(value) }));

  const width = Math.max(...[...head, ...who, ...rest].map((r) => r.label.length), 0);
  const block = (rows: DetailRow[]) =>
    rows.map((r) => `${r.label.padEnd(width)}  ${r.value}`).join('\n');

  const sections = [
    summary ? `What happened\n${summary}` : null,
    block(head),
    who.length > 0 ? block(who) : null,
    rest.length > 0 ? `Details\n${block(rest)}` : null,
  ].filter(Boolean);

  return sections.join('\n\n');
}
