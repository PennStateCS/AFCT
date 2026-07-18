import { createHash, randomInt } from 'crypto';

/**
 * Pure helpers for course group sets: name normalization, duplicate-name
 * suggestion, the random-assignment balancing plan, the optimistic-concurrency
 * basis token, and the (currently inert) lock seam. Kept DB-free so they are
 * trivially unit-testable; the routes supply already-fetched rows.
 */

// ─── Names ──────────────────────────────────────────────────────────────────

/** Trim a user-entered name. */
export function normalizeName(name: string): string {
  return name.trim();
}

/** Case-insensitive, whitespace-insensitive equality for duplicate detection. */
export function namesEqualInsensitive(a: string, b: string): boolean {
  return normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase();
}

/** The editable default name for the Nth group (1-based): "Group 1". */
export function defaultGroupName(index: number): string {
  return `Group ${index}`;
}

/**
 * Suggest a name for a duplicated set: "X Copy", then "X Copy 2", "X Copy 3", …
 * skipping any that already exist (compared case-insensitively). Never returns a
 * name that collides with `existingNames`.
 */
export function suggestDuplicateName(baseName: string, existingNames: string[]): string {
  const taken = new Set(existingNames.map((n) => normalizeName(n).toLowerCase()));
  const base = `${normalizeName(baseName)} Copy`;
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  // Extremely unlikely fallback.
  return `${base} ${Date.now()}`;
}

// ─── Optimistic concurrency ───────────────────────────────────────────────────

export type BasisMembership = { userId: string; groupId: string };

/**
 * A stable fingerprint of a set's current memberships. Two states with the same
 * (student → group) pairs produce the same token regardless of row order, so a
 * random-assignment apply can detect that another staff member changed the set
 * after the preview was generated.
 */
export function computeMembershipBasis(memberships: BasisMembership[]): string {
  const normalized = memberships
    .map((m) => `${m.userId}:${m.groupId}`)
    .sort()
    .join('|');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

// ─── Random assignment ────────────────────────────────────────────────────────

/** Cryptographic Fisher-Yates shuffle, returning a new array. */
export function cryptoShuffle<T>(items: T[]): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
  }
  return arr;
}

export type RandomAssignPlanInput = {
  /** Existing groups in the set, in a stable order. */
  groups: { id: string }[];
  /** Current membership of every already-assigned student in the set. */
  currentByUser: Map<string, string>;
  /** Students the instructor chose to include. */
  selectedStudentIds: string[];
  /** Ids that are eligible (active + STUDENT). Anything else is skipped. */
  eligibleActiveIds: Set<string>;
  /** Move selected students who already hold a group (true) or leave them (false). */
  reassignSelected: boolean;
  /** Injectable shuffle for deterministic tests; defaults to a CSPRNG shuffle. */
  shuffle?: <T>(items: T[]) => T[];
};

export type RandomAssignPlan = {
  /** The membership changes to apply: each places one student in one group. */
  operations: { userId: string; groupId: string }[];
  /** Selected students skipped because they are inactive/ineligible. */
  skippedInactive: string[];
};

/**
 * Compute a balanced random assignment. Selected, eligible students are shuffled
 * and dealt into the existing groups so that the resulting TOTAL group sizes are
 * as even as possible (final sizes differ by at most one when an even split is
 * impossible). Students who are kept in place (not selected, or selected but not
 * being reassigned) still count toward their group's size, so the balance
 * accounts for them. Never creates groups.
 */
export function planRandomAssignment(input: RandomAssignPlanInput): RandomAssignPlan {
  const { groups, currentByUser, selectedStudentIds, eligibleActiveIds, reassignSelected } = input;
  const shuffle = input.shuffle ?? cryptoShuffle;

  if (groups.length === 0) {
    return { operations: [], skippedInactive: [] };
  }

  const selected = Array.from(new Set(selectedStudentIds));
  const skippedInactive = selected.filter((id) => !eligibleActiveIds.has(id));
  const eligibleSelected = selected.filter((id) => eligibleActiveIds.has(id));

  // Which of the selected students will actually be (re)placed by the shuffle.
  const toPlace = eligibleSelected.filter(
    (id) => reassignSelected || !currentByUser.has(id),
  );
  const toPlaceSet = new Set(toPlace);

  // Seed each group's size with the students who are staying put: everyone
  // currently in the set who is NOT about to be re-dealt.
  const sizes = new Map<string, number>(groups.map((g) => [g.id, 0]));
  for (const [userId, groupId] of currentByUser) {
    if (toPlaceSet.has(userId)) continue; // being re-dealt
    if (sizes.has(groupId)) sizes.set(groupId, (sizes.get(groupId) ?? 0) + 1);
  }

  // Deal shuffled students into the currently-smallest group each time.
  const shuffled = shuffle(toPlace);
  const operations: { userId: string; groupId: string }[] = [];
  for (const userId of shuffled) {
    let targetId = groups[0]!.id;
    let min = sizes.get(targetId) ?? 0;
    for (const g of groups) {
      const size = sizes.get(g.id) ?? 0;
      if (size < min) {
        min = size;
        targetId = g.id;
      }
    }
    sizes.set(targetId, (sizes.get(targetId) ?? 0) + 1);
    // Skip a no-op move (already in the target group).
    if (currentByUser.get(userId) !== targetId) {
      operations.push({ userId, groupId: targetId });
    }
  }

  return { operations, skippedInactive };
}

// ─── Lock ─────────────────────────────────────────────────────────────────────

// The lock/deletion checks themselves need the DB (they look at submissions and
// assignment references), so they live in group-set-service.ts. This is just the
// shared error type.
export class GroupSetLockedError extends Error {
  constructor(message = 'This group set is locked because it has submissions and cannot be changed.') {
    super(message);
    this.name = 'GroupSetLockedError';
  }
}
