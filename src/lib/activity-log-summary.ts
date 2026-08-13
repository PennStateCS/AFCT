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
/** The records an entry points at, named rather than left as identifiers. */
export type RelatedRecords = {
  course?: string | null;
  assignment?: string | null;
  problem?: string | null;
  submission?: string | null;
};

export function formatActivityDetails(entry: {
  action: string;
  timestamp?: string | Date | null;
  severity?: string | null;
  category?: string | null;
  ipAddress?: string | null;
  metadata?: Metadata;
  related?: RelatedRecords | null;
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
