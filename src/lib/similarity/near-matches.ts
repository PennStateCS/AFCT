// Finding submissions that share uncommon structure without being equal.
//
// The two hashes are all-or-nothing. This is the check that survives an edit: it compares
// the small pieces `provenance.ts` describes a file by, and reports pairs that share more
// of the *unusual* pieces than two people working separately would.
//
// Three rules keep it honest.
//
// Rarity does the work. Correct answers converge, so a piece of structure most of the class
// has says nothing at all and is thrown away before any pair is scored. What is left is the
// peculiar: the extra state nobody needed, the transition curve dragged into an odd place.
//
// Evidence, not a number. The score exists to rank candidates and to decide what crosses the
// bar; it is never shown, never stored, and can be recomputed at any time. What a reader
// sees is a list of things the two submissions actually share, each of which the code can
// point at.
//
// Nothing here is a verdict. It says two files have unusual structure in common. Why they
// do is not a question this code can answer.

import type { ProvenanceFeatures } from './provenance';

/** A submission as this comparison needs it. */
export type NearMatchInput = {
  id: string;
  studentId: string;
  studentGroupId: string | null;
  submittedAt: Date;
  /** Set when the exact or shape check already grouped this submission with others. */
  shapeKey: string | null;
  features: ProvenanceFeatures;
};

export type NearMatchEvidence = {
  /** One short factual sentence, safe to show as-is. */
  detail: string;
};

export type NearMatch = {
  a: NearMatchInput;
  b: NearMatchInput;
  /** Ranking only. Never shown, never stored. */
  score: number;
  evidence: NearMatchEvidence[];
};

/**
 * A feature held by at least this share of the students who submitted the problem is
 * discarded before anything is compared. Ten of forty students having the same little piece
 * of structure means the problem produces it, not that anybody shared a file.
 *
 * Same philosophy as the Common badge on a whole match, applied a level down, and the same
 * boundary: at exactly this share the rule says common, not rare. `isCommon` in
 * `lib/similarity/rarity` treats the boundary the same way, and two thresholds written as
 * one number have to agree about what the number means.
 */
export const FEATURE_COMMON_SHARE = 0.25;

/**
 * How much shared rare structure a pair needs before it is worth a reader's time.
 *
 * Both bars have to be cleared. The count stops a pair being reported on one coincidence;
 * the share stops two large machines being reported because they happen to have four odd
 * pieces in common out of hundreds. They are deliberately blunt, deliberately documented
 * here rather than tuned per course, and deliberately conservative: this check is allowed
 * to miss things, and is not allowed to cry wolf.
 */
export const MIN_SHARED_RARE_FEATURES = 4;
export const MIN_SHARED_SHARE = 0.5;

/**
 * How different in size two submissions may be and still be versions of one another.
 *
 * A copied file that was edited differs by a state or two. Two machines differing by half
 * their size are two machines, however much skeleton they have in common, and calling them
 * "structurally similar" would be wrong in a way a reader could see at a glance, which is
 * the fastest way to lose their trust in the rest of the page.
 */
export const MAX_SIZE_DIFFERENCE_SHARE = 0.4;

function comparableInSize(a: ProvenanceFeatures, b: ProvenanceFeatures): boolean {
  const compare = (x: number, y: number) => {
    const larger = Math.max(x, y);
    return larger === 0 ? true : Math.abs(x - y) / larger <= MAX_SIZE_DIFFERENCE_SHARE;
  };
  return (
    compare(a.stateCount, b.stateCount) && compare(a.transitionCount, b.transitionCount)
  );
}

/**
 * Weight a feature by how unusual it is: rarer counts for more, common counts for nothing.
 *
 * A feature only one student holds counts for nothing either. It cannot be shared, so it is
 * no evidence about any pair; and being the rarest thing in the problem it would otherwise
 * carry the heaviest weight in the denominator below, quietly penalising a submission for
 * being distinctive. Two files differing in a couple of places fell under the bar that way.
 */
function weightOf(studentsWithFeature: number, studentsInProblem: number): number {
  if (studentsInProblem === 0 || studentsWithFeature < 2) return 0;
  const share = studentsWithFeature / studentsInProblem;
  if (share >= FEATURE_COMMON_SHARE) return 0;
  // 1/share, so a feature two of forty students have counts twenty times one that ten have.
  return 1 / Math.max(share, 1 / studentsInProblem);
}

const prefixOf = (feature: string): string => feature.slice(0, feature.indexOf(':'));

/**
 * Pairs of submissions that share uncommon structure, most convincing first.
 *
 * Every attempt is compared, not just one per student: a copied file can arrive on a fourth
 * try as easily as a first. Two students still get one card between them, showing the two
 * attempts that match each other best.
 *
 * Only pairs the exact and shape checks left behind: if two submissions already sit in the
 * same match because their shape hashes agree, saying so again here adds nothing. Group
 * assignments are skipped for the same reason they are elsewhere, since teammates sharing
 * work is the group feature working.
 */
export function findNearMatches(submissions: NearMatchInput[]): NearMatch[] {
  if (submissions.length < 2) return [];

  const students = new Set(submissions.map((submission) => submission.studentId));
  if (students.size < 2) return [];

  // How many STUDENTS hold each feature, counted once each however many times they
  // submitted: a student who tried five times must not make their own quirks look common.
  const holders = new Map<string, Set<string>>();
  for (const submission of submissions) {
    for (const feature of new Set(submission.features.features)) {
      holders.set(feature, (holders.get(feature) ?? new Set<string>()).add(submission.studentId));
    }
  }

  const weights = new Map<string, number>();
  for (const [feature, studentsWithIt] of holders) {
    const weight = weightOf(studentsWithIt.size, students.size);
    if (weight > 0) weights.set(feature, weight);
  }

  // Index the rare features so candidates come from sharing one, rather than from comparing
  // everybody with everybody.
  const index = new Map<string, NearMatchInput[]>();
  for (const submission of submissions) {
    for (const feature of new Set(submission.features.features)) {
      if (!weights.has(feature)) continue;
      index.set(feature, [...(index.get(feature) ?? []), submission]);
    }
  }

  const candidates = new Map<string, { a: NearMatchInput; b: NearMatchInput }>();
  for (const holdersOfFeature of index.values()) {
    // A rare feature is held by few students by definition, so this stays small.
    for (let i = 0; i < holdersOfFeature.length; i++) {
      for (let j = i + 1; j < holdersOfFeature.length; j++) {
        const a = holdersOfFeature[i]!;
        const b = holdersOfFeature[j]!;
        // One student's own attempts are not a pair with each other.
        if (a.studentId === b.studentId) continue;
        if (a.features.machineType !== b.features.machineType) continue;
        // Teammates on a group assignment share their work by design.
        if (a.studentGroupId && a.studentGroupId === b.studentGroupId) continue;
        // Already in the same match on the strength of an exact or shape hash.
        if (a.shapeKey && a.shapeKey === b.shapeKey) continue;
        const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        candidates.set(key, a.id < b.id ? { a, b } : { a: b, b: a });
      }
    }
  }

  // Every attempt is compared, because a file can be copied on a fourth try as easily as a
  // first, and comparing only one attempt each would miss exactly that. But two students get
  // one card between them: the attempts that match each other best, not one per combination.
  const bestPerStudentPair = new Map<string, NearMatch>();
  for (const { a, b } of candidates.values()) {
    const match = scorePair(a, b, weights);
    if (!match) continue;
    const pairKey = [a.studentId, b.studentId].sort().join(':');
    const held = bestPerStudentPair.get(pairKey);
    if (!held || match.score > held.score) bestPerStudentPair.set(pairKey, match);
  }

  return [...bestPerStudentPair.values()].sort((x, y) => y.score - x.score);
}

function scorePair(
  a: NearMatchInput,
  b: NearMatchInput,
  weights: Map<string, number>,
): NearMatch | null {
  const aFeatures = new Set(a.features.features);
  const bFeatures = new Set(b.features.features);
  const shared = [...aFeatures].filter((feature) => bFeatures.has(feature));

  if (!comparableInSize(a.features, b.features)) return null;

  const sharedRare = shared.filter((feature) => weights.has(feature));
  if (sharedRare.length < MIN_SHARED_RARE_FEATURES) return null;

  const weightOfSet = (features: Iterable<string>) =>
    [...features].reduce((total, feature) => total + (weights.get(feature) ?? 0), 0);

  const sharedWeight = weightOfSet(sharedRare);
  // Measured against the smaller of the two, so adding material to a copy cannot dilute the
  // evidence away. Only weighted features count on either side, so what is being asked is
  // "of the shareable uncommon structure this submission carries, how much is in both".
  const smaller = Math.min(weightOfSet(aFeatures), weightOfSet(bFeatures));
  if (smaller === 0) return null;

  const share = sharedWeight / smaller;
  if (share < MIN_SHARED_SHARE) return null;

  return { a, b, score: sharedWeight * share, evidence: describe(a, b, shared, sharedRare) };
}

/**
 * Turn what the two submissions share into sentences a reader can check.
 *
 * Every line is a count of something specific. Nothing here characterises the students, and
 * nothing implies how the sharing came about.
 */
function describe(
  a: NearMatchInput,
  b: NearMatchInput,
  shared: string[],
  sharedRare: string[],
): NearMatchEvidence[] {
  const evidence: NearMatchEvidence[] = [];
  const countByPrefix = (features: string[], prefix: string) =>
    features.filter((feature) => prefixOf(feature) === prefix).length;

  const localShared = countByPrefix(shared, 'f');
  const localTotal = Math.min(
    a.features.features.filter((feature) => prefixOf(feature) === 'f').length,
    b.features.features.filter((feature) => prefixOf(feature) === 'f').length,
  );
  if (localShared > 0 && localTotal > 0) {
    // The rare count is the part that carries weight: sharing the ordinary pieces of a
    // correct answer is what a class does, and saying only "12 of 12" would let a reader
    // think otherwise.
    const localRare = countByPrefix(sharedRare, 'f');
    evidence.push({
      detail:
        `${localShared} of ${localTotal} pieces of local structure are the same` +
        (localRare > 0
          ? `, ${localRare} of them uncommon in this class`
          : ''),
    });
  }

  const states = Math.abs(a.features.stateCount - b.features.stateCount);
  const transitions = Math.abs(a.features.transitionCount - b.features.transitionCount);
  if (states === 0 && transitions === 0) {
    evidence.push({ detail: 'Both have the same number of states and transitions' });
  } else {
    const parts: string[] = [];
    if (states > 0) parts.push(`${states} state${states === 1 ? '' : 's'}`);
    if (transitions > 0) parts.push(`${transitions} transition${transitions === 1 ? '' : 's'}`);
    evidence.push({ detail: `They differ by ${parts.join(' and ')}` });
  }

  const idShared = countByPrefix(sharedRare, 't');
  if (idShared >= 2) {
    evidence.push({
      detail: `${idShared} pairs of states keep the same underlying identifiers, which are not the visible names`,
    });
  }

  const placeShared = countByPrefix(sharedRare, 'g');
  if (placeShared >= 2) {
    evidence.push({
      detail: `${placeShared} states sit in the same place relative to the rest of the drawing`,
    });
  }

  const oddShared = countByPrefix(sharedRare, 'u');
  if (oddShared >= 1) {
    evidence.push({
      detail:
        oddShared === 1
          ? 'Both contain the same unusual feature: a state nothing reaches, a dead end, or a repeated transition'
          : `Both contain the same ${oddShared} unusual features, such as a state nothing reaches or a dead end`,
    });
  }

  const writtenShared = countByPrefix(sharedRare, 'l') + countByPrefix(sharedRare, 'n');
  if (writtenShared >= 1) {
    evidence.push({
      detail: `${writtenShared} piece${writtenShared === 1 ? '' : 's'} of text written on the drawing ${writtenShared === 1 ? 'is' : 'are'} word for word the same`,
    });
  }

  const blockShared = countByPrefix(sharedRare, 'b');
  if (blockShared >= 2) {
    evidence.push({
      detail: `${blockShared} building-block details are the same, including how the machine is divided up`,
    });
  }

  const curveShared = countByPrefix(sharedRare, 'c');
  if (curveShared >= 1) {
    evidence.push({
      detail: `${curveShared} transition${curveShared === 1 ? ' has' : 's have'} the same hand-adjusted curve`,
    });
  }

  const gapMs = Math.abs(a.submittedAt.getTime() - b.submittedAt.getTime());
  const minutes = Math.round(gapMs / 60_000);
  if (minutes <= 120) {
    evidence.push({
      detail: `Submitted ${minutes < 1 ? 'less than a minute' : `${minutes} minute${minutes === 1 ? '' : 's'}`} apart`,
    });
  }

  return evidence;
}
