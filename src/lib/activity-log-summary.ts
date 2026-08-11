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

/** How an identity came to be attached, in the words a person would use. */
const VIA: Record<string, string> = {
  SELF_SERVICE: 'connected by the account holder',
  AUTO_VERIFIED_EMAIL: 'matched on email',
  JUST_IN_TIME: 'created on first sign-in',
  ADMIN: 'connected by an administrator',
};

export function describeActivity(action: string, metadata: Metadata): string | null {
  switch (action) {
    case 'LTI_ROSTER_SYNCED':
      // The headline only. Who was added or dropped has an entry of its own, using the same
      // actions as a roster change made by hand, so it can be searched and filtered like one.
      return counts(metadata);

    case 'ENROLL_USER':
    case 'DROP_FROM_COURSE':
    case 'REENROLL_IN_COURSE': {
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

    case 'IDENTITY_LINK_DENIED':
      return str(metadata, 'reason');

    case 'IDENTITY_UNLINKED':
      return str(metadata, 'issuer');

    default:
      return null;
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
  // camelCase to words, capitalised once: "scoreMaximum" becomes "Score maximum".
  key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

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
