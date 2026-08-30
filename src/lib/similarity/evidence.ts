// How the Similarity tab decides what to show first, and how strongly.
//
// Pure functions over what the API returns, kept apart from the components so the judgements
// on this page can be read and tested in one place. Nothing here decides anything about a
// student: it grades the strength of the *artifact evidence*, which is a statement about two
// files, and orders the page so the strongest is read first.

import type { SubmissionMatchGroup, MatchSubmission } from '@/lib/similarity/matches';
import { isCommon, type ReviewSubject } from '@/lib/similarity/rarity';

/**
 * What kind of thing two submissions have in common.
 *
 * The order matters and is the whole point of the scale: the same saved artifact says far
 * more than the same machine, which says more than shared structure. Students do
 * independently reach the same correct answer; they do not independently save it with every
 * state in the same place.
 *
 * The last two are not places on that scale. `reference` is work that IS the solution the
 * instructor posted, and `common` is work enough of the class submitted to be the expected
 * answer. Both are explanations of a match rather than evidence about one, which is why they
 * carry no strength and sort to the bottom.
 */
export type MatchType = 'exact' | 'same-machine' | 'structural' | 'reference' | 'common';

/** How strong the artifact evidence is. Never how likely misconduct is. */
export type EvidenceStrength = 'very-strong' | 'strong' | 'possible' | 'none';

export const MATCH_LABEL: Record<MatchType, string> = {
  exact: 'Exact JFLAP artifact',
  'same-machine': 'Same machine',
  structural: 'Structurally similar',
  reference: 'Instructor reference solution',
  common: 'Common answer',
};

export const STRENGTH_LABEL: Record<EvidenceStrength, string> = {
  'very-strong': 'Very strong',
  strong: 'Strong',
  possible: 'Possible',
  none: 'Expected',
};

export const STRENGTH_OF: Record<MatchType, EvidenceStrength> = {
  exact: 'very-strong',
  'same-machine': 'strong',
  structural: 'possible',
  // These two are outside the scale rather than at the bottom of it: they are what a correct
  // answer looks like, not weak evidence of anything. Everybody handed the reference solution
  // has the same artifact by definition, so "very strong" would be measuring the handout.
  reference: 'none',
  common: 'none',
};

/**
 * What a relationship is CALLED on the page, which can be stronger than what the detector
 * matched on.
 *
 * The detector's kinds are about how a match was found. This one is about what can honestly
 * be said of the match once it has been found, and there is one thing stronger than the same
 * saved artifact: the same raw file, nothing normalised away. That is not another way of
 * finding matches and never becomes one, which is why it lives here and not in `MatchType`.
 */
export type DisplayMatchType = MatchType | 'byte-identical';

export const DISPLAY_LABEL: Record<DisplayMatchType, string> = {
  ...MATCH_LABEL,
  // Says what was measured rather than naming a file format, because that is the whole
  // reason this kind exists: no normalisation, no qualifier, the same bytes.
  'byte-identical': 'Byte-for-byte identical',
};

export const DISPLAY_STRENGTH_OF: Record<DisplayMatchType, EvidenceStrength> = {
  ...STRENGTH_OF,
  // The same rung as an exact artifact rather than a new one above it. It is a sharper
  // statement of the same finding, not a louder one, and the page has no tier above
  // "very strong" for a reason.
  'byte-identical': 'very-strong',
};

/**
 * Every submission in this relationship is the same file to the byte.
 *
 * Every one of them, deliberately: the badge speaks for the whole relationship, so a subset
 * that agrees does not earn it. A missing byte key means the file was stored before it was
 * hashed, which is "not known" rather than "different", so it blocks the claim without
 * contradicting it.
 */
export function isWhollyByteIdentical(group: SubmissionMatchGroup): boolean {
  if (group.submissions.length < 2) return false;
  const keys = group.submissions.map((submission) => submission.byteKey);
  if (keys.some((key) => !key)) return false;
  return new Set(keys).size === 1;
}

/**
 * What to call one relationship: its kind, or the stronger thing that is true of all of it.
 *
 * Only an exact match can be upgraded. Identical bytes normalise to identical contents, so
 * anything byte-equal is already exact, and requiring it here means a partly-identical group
 * or a structural one can never be labelled with a claim about raw files.
 */
export function displayTypeOf(
  group: SubmissionMatchGroup,
  commonShare: number,
  subject: ReviewSubject = 'student',
): DisplayMatchType {
  const type = matchTypeOf(group, commonShare, subject);
  return type === 'exact' && isWhollyByteIdentical(group) ? 'byte-identical' : type;
}

/**
 * Groups the page explains rather than asks about: the expected answer, and the answer the
 * instructor supplied. Still shown, still openable, kept out of the review queue.
 */
export function isSetAside(type: DisplayMatchType): boolean {
  return type === 'common' || type === 'reference';
}

/**
 * Which kind a match is.
 *
 * A group where every student sent the same saved artifact is exact. One where only some did
 * is the same machine, with the exact part called out inside it. Anything the provenance
 * check found is structural.
 *
 * Commonality explains most of that away: at a large enough share of a class, alike work is
 * convergence. It cannot explain away two things.
 *
 * The first is the instructor's own file, which is why that is asked about first: everybody
 * handed the solution has it, so the match measures the handout.
 *
 * The second is IDENTICAL BYTES, and this is the one the threshold used to hide. Every other
 * check normalises something before comparing, so "half the class submitted this" really can
 * mean half the class independently wrote the same right answer: a grammar or a regular
 * expression has no layout to differ in. Nothing normalises a raw file. Twelve students
 * turning in the same bytes did not each type them, and a dial the reader sets for triage
 * must not be able to delete that observation. It stays visible and stays a fact; what it
 * means is still the professor's to decide, and how widely it was shared is shown beside it.
 */
export function matchTypeOf(
  group: SubmissionMatchGroup,
  commonShare: number,
  subject: ReviewSubject = 'student',
): MatchType {
  // Counted in the same unit the page talks in: teams on a group assignment, students
  // otherwise. A ratio of students against a denominator of groups would be a number about
  // nothing, and the threshold the reader is looking at says which one it is.
  const common = isCommon(group, commonShare, subject);

  // The instructor posted this work. Everyone holding that file has it, so how alike the
  // artifacts are says nothing about how they got there, and calling it very strong evidence
  // would be reporting the handout back to the person who wrote it. A widely shared posted
  // solution keeps reading as the common answer, which is what it is; either way the page
  // sets it aside rather than asking anybody to review it.
  if (group.matchesAnswerFile) return common ? 'common' : 'reference';

  // Identical bytes, and not the instructor's file. `displayTypeOf` sharpens this to
  // `byte-identical`; what matters here is that it is not `common`, because a set-aside
  // match is one the reader never sees.
  //
  // Asked only of a group that is wholly one artifact, which is what identical bytes always
  // produce: raw equality implies equal normalised contents, and a provenance match is a
  // pair that were never equal at all. Stated rather than assumed, so nothing here can label
  // a partly-identical group by a fact that is true of only some of it.
  const whollyOneArtifact =
    group.kind === 'same-work' && group.identicalStudentCount >= group.studentCount;
  if (whollyOneArtifact && isWhollyByteIdentical(group)) return 'exact';

  if (common) return 'common';
  if (group.kind === 'near') return 'structural';
  return group.identicalStudentCount >= group.studentCount ? 'exact' : 'same-machine';
}

/**
 * A set of submissions that are related to each other, directly or through somebody else.
 *
 * In a large course the same students turn up in relationship after relationship: four
 * students who all share work produce six pairs, and six near-identical cards is not a
 * review, it is a scrolling exercise. Anything connected through a shared student is one
 * group with one summary, and the relationships inside it stay available underneath.
 */
export type MatchCluster = {
  id: string;
  problem: SubmissionMatchGroup['problem'];
  /** The relationships this group is made of, strongest first. */
  relationships: SubmissionMatchGroup[];
  /** Every student involved, earliest submission first, one entry each. */
  students: MatchSubmission[];
  /**
   * Every submission that actually matched, earliest first, deduplicated by submission id
   * rather than by student.
   *
   * `students` answers "who is in this", which is what the counts are about. This answers
   * "what did they send", which is what a reader checks: a problem can allow several
   * attempts, and a student whose second and fourth attempts both matched has two rows here.
   * Nothing else in the group is included, so an attempt that had nothing to do with the
   * finding never appears.
   */
  attempts: MatchSubmission[];
  /** The groups involved, for a group assignment. Empty for an individual one. */
  groups: { id: string; name: string }[];
  type: MatchType;
  /**
   * What the group is CALLED, which is the strongest thing true of every relationship in it.
   *
   * The same as `type` unless every relationship is byte-identical, in which case the card
   * can say so. Falls back to `type` for a mixed group, where the card shows the neutral
   * badge instead and the relationships carry their own.
   */
  displayType: DisplayMatchType;
  strength: EvidenceStrength;
  counts: Record<Exclude<DisplayMatchType, 'common'>, number>;
  /**
   * Every relationship in this group is the same kind of match, judged the way the page
   * labels them.
   *
   * A group of one kind can be labelled with that kind: it describes all of it. A group
   * holding an exact match and a structural one cannot, because the strongest of them is not
   * true of everybody in it, so the card says how many relationships there are and each one
   * carries its own badge. Byte-for-byte identical counts as its own kind here for the same
   * reason: one byte-identical relationship among exact ones does not make the group
   * byte-identical.
   */
  homogeneous: boolean;
  /**
   * The most students anywhere in this group whose files are identical byte for byte. 1 when
   * no two are, and also 1 when nobody's file has been hashed yet, so the page says nothing
   * rather than guessing.
   */
  byteIdenticalStudentCount: number;
  /**
   * This work is shared widely enough to pass the reader's common-answer threshold.
   *
   * For most kinds that IS the classification and the group is set aside. For byte-identical
   * work it is context instead: the observation stands, and how much of the class shares the
   * file is something the reader should know while judging it.
   */
  aboveCommonShare: boolean;
  problemStudentCount: number;
  /** How many groups submitted this problem at all. 0 for an individual assignment. */
  problemGroupCount: number;
  reusedAfterPass: boolean;
  /**
   * EVERY relationship in this group is work that matches the problem's own posted solution.
   *
   * Deliberately all of them rather than any of them: in a group held together by a shared
   * student, one pair being the reference solution explains that pair and says nothing about
   * the rest, and stamping the whole group with it would excuse matches nobody checked.
   * `answerFileRelationships` carries the partial case.
   */
  matchesAnswerFile: boolean;
  /** How many of the relationships in this group are the posted solution. */
  answerFileRelationships: number;
  /** The shortest interval between two different students anywhere in the group. */
  closestGapMs: number | null;
  earliest: MatchSubmission | null;
  stateCount: number | null;
  transitionCount: number | null;
};

const TYPE_RANK: Record<MatchType, number> = {
  exact: 0,
  'same-machine': 1,
  structural: 2,
  reference: 3,
  common: 4,
};

/**
 * Every matched submission in the group, once each, earliest first.
 *
 * Deduplicated by submission id and NOT by student: the same student's second and fourth
 * attempts are two different things that matched, and collapsing them to one row hides the
 * attempt a reader is being asked about. The same submission can appear in two relationships
 * of one cluster, which is what the id check is for.
 */
function attemptsOf(groups: SubmissionMatchGroup[]): MatchSubmission[] {
  const seen = new Map<string, MatchSubmission>();
  for (const group of groups) {
    for (const submission of group.submissions) {
      if (!seen.has(submission.id)) seen.set(submission.id, submission);
    }
  }
  return [...seen.values()].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

/** One entry per student, earliest submission first. */
function studentsOf(groups: SubmissionMatchGroup[]): MatchSubmission[] {
  const earliest = new Map<string, MatchSubmission>();
  for (const group of groups) {
    for (const submission of group.submissions) {
      const held = earliest.get(submission.student.id);
      if (!held || submission.submittedAt < held.submittedAt) {
        earliest.set(submission.student.id, submission);
      }
    }
  }
  return [...earliest.values()].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

/**
 * Group relationships that share a student into one cluster, per problem.
 *
 * Connected components, which is the simplest thing that answers the question a reader is
 * asking: who is involved in this, all of them, in one place. No clustering cleverness
 * beyond that; the data model already carries everything it needs.
 */
export function clusterMatches(
  groups: SubmissionMatchGroup[],
  commonShare: number,
  subject: ReviewSubject = 'student',
): MatchCluster[] {
  const clusters: MatchCluster[] = [];

  const byProblem = new Map<string, SubmissionMatchGroup[]>();
  for (const group of groups) {
    byProblem.set(group.problem.id, [...(byProblem.get(group.problem.id) ?? []), group]);
  }

  for (const [problemId, problemGroups] of byProblem) {
    // Common answers stand alone: folding one into a cluster of real findings would hide it
    // in something it does not belong to, and the page sets them aside on purpose.
    const commonGroups = problemGroups.filter(
      (group) => matchTypeOf(group, commonShare, subject) === 'common',
    );
    const rest = problemGroups.filter(
      (group) => matchTypeOf(group, commonShare, subject) !== 'common',
    );

    // Union-find over students, so anything connected through a shared student comes out
    // together however the relationships were discovered.
    const parent = new Map<string, string>();
    const find = (id: string): string => {
      const seen = parent.get(id);
      if (seen === undefined || seen === id) return id;
      const root = find(seen);
      parent.set(id, root);
      return root;
    };
    const union = (a: string, b: string) => {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent.set(rootA, rootB);
    };

    for (const group of rest) {
      const ids = group.submissions.map((submission) => submission.student.id);
      for (const id of ids) if (!parent.has(id)) parent.set(id, id);
      for (let index = 1; index < ids.length; index++)
        union(ids[0] as string, ids[index] as string);
    }

    const members = new Map<string, SubmissionMatchGroup[]>();
    for (const group of rest) {
      const root = find(group.submissions[0]?.student.id ?? group.matchId);
      members.set(root, [...(members.get(root) ?? []), group]);
    }

    for (const [root, related] of members) {
      clusters.push(buildCluster(`${problemId}:${root}`, related, commonShare, subject));
    }
    for (const group of commonGroups) {
      clusters.push(buildCluster(`${problemId}:${group.matchId}`, [group], commonShare, subject));
    }
  }

  return clusters.sort(compareClusters);
}

function buildCluster(
  id: string,
  relationships: SubmissionMatchGroup[],
  commonShare: number,
  subject: ReviewSubject,
): MatchCluster {
  const ranked = [...relationships].sort(
    (a, b) =>
      TYPE_RANK[matchTypeOf(a, commonShare, subject)] -
      TYPE_RANK[matchTypeOf(b, commonShare, subject)],
  );
  const first = ranked[0] as SubmissionMatchGroup;
  const type = matchTypeOf(first, commonShare, subject);

  // Counted as the page labels them, so what the card says its relationships are cannot
  // disagree with the badges on those relationships.
  const counts = {
    'byte-identical': 0,
    exact: 0,
    'same-machine': 0,
    structural: 0,
    reference: 0,
  } as MatchCluster['counts'];
  for (const group of ranked) {
    const groupType = displayTypeOf(group, commonShare, subject);
    if (groupType !== 'common') counts[groupType] += 1;
  }

  const students = studentsOf(ranked);
  const attempts = attemptsOf(ranked);
  const displayTypes = ranked.map((group) => displayTypeOf(group, commonShare, subject));
  const homogeneous = new Set(displayTypes).size === 1;
  // One entry per group, in the order they first appear, so a group assignment can be read
  // as teams rather than as a list of whoever happened to press submit.
  const groups = [
    ...new Map(
      attempts
        .map((submission) => submission.studentGroup)
        .filter((group): group is { id: string; name: string } => group !== null)
        .map((group) => [group.id, group]),
    ).values(),
  ];
  const gaps = ranked
    .map((group) => group.closestGapMs)
    .filter((gap): gap is number => gap !== null);
  const sized = ranked.find((group) => group.stateCount !== null);

  return {
    id,
    problem: first.problem,
    relationships: ranked,
    students,
    attempts,
    groups,
    type,
    // Only a group where every relationship says the same thing can be labelled with it.
    displayType: homogeneous ? (displayTypes[0] as DisplayMatchType) : type,
    strength: STRENGTH_OF[type],
    counts,
    homogeneous,
    byteIdenticalStudentCount: Math.max(...ranked.map((group) => group.byteIdenticalStudentCount)),
    // Any relationship being that widely shared is worth saying, because the reader is being
    // shown the group on the strength of one of them.
    aboveCommonShare: ranked.some((group) => isCommon(group, commonShare, subject)),
    problemStudentCount: first.problemStudentCount,
    problemGroupCount: first.problemGroupCount,
    reusedAfterPass: ranked.some((group) => group.reusedAfterPass),
    matchesAnswerFile: ranked.every((group) => group.matchesAnswerFile),
    answerFileRelationships: ranked.filter((group) => group.matchesAnswerFile).length,
    closestGapMs: gaps.length > 0 ? Math.min(...gaps) : null,
    earliest: students[0] ?? null,
    stateCount: sized?.stateCount ?? null,
    transitionCount: sized?.transitionCount ?? null,
  };
}

/**
 * Strongest evidence first, and within a kind the rarer and the more recent.
 *
 * Reuse after passing lifts a group above its equals rather than above everything: it is
 * context about timing, and a weaker artifact match does not become a stronger one because
 * of when it arrived.
 */
function compareClusters(a: MatchCluster, b: MatchCluster): number {
  return (
    TYPE_RANK[a.type] - TYPE_RANK[b.type] ||
    Number(b.reusedAfterPass) - Number(a.reusedAfterPass) ||
    a.students.length - b.students.length ||
    (b.earliest?.submittedAt ?? '').localeCompare(a.earliest?.submittedAt ?? '')
  );
}

/** The page's opening lines: what is here, and whether any of it is the strongest kind. */
export function summarise(clusters: MatchCluster[]): string[] {
  const worthReviewing = clusters.filter((cluster) => !isSetAside(cluster.type));
  const setAside = clusters.length - worthReviewing.length;
  // Said the same way in both branches: what was set aside, and how many.
  const asideLine = `${setAside} group${setAside === 1 ? '' : 's'} set aside as a common answer or the posted solution.`;

  if (worthReviewing.length === 0) {
    return setAside === 0
      ? ['No two students submitted related work.']
      : [`No matches worth reviewing. ${asideLine}`];
  }

  const problems = new Set(worthReviewing.map((cluster) => cluster.problem.id)).size;
  const lines = [
    `${worthReviewing.length} match group${worthReviewing.length === 1 ? '' : 's'} worth reviewing across ` +
      `${problems} problem${problems === 1 ? '' : 's'}.`,
  ];

  if (setAside > 0) lines.push(asideLine);

  // Said separately because they are different claims, and the stronger one first. A group
  // holding both kinds is counted in both lines, which is what "contain" means here: the two
  // numbers are what is inside the groups, not a partition of them.
  const byteIdentical = worthReviewing.filter((cluster) => cluster.counts['byte-identical'] > 0);
  if (byteIdentical.length > 0) {
    const n = byteIdentical.length;
    lines.push(`${n} contain${n === 1 ? 's' : ''} a byte-for-byte identical match.`);
  }

  const exact = worthReviewing.filter((cluster) => cluster.counts.exact > 0).length;
  if (exact > 0) {
    lines.push(`${exact} contain${exact === 1 ? 's' : ''} an exact artifact match.`);
  }

  const reused = worthReviewing.filter((cluster) => cluster.reusedAfterPass).length;
  if (reused > 0) {
    lines.push(
      `${reused} include${reused === 1 ? 's' : ''} work reused after another student received a correct result.`,
    );
  }

  // The pair count stays available but stops being the mental model for the page.
  const relationships = worthReviewing.reduce(
    (total, cluster) => total + cluster.relationships.length,
    0,
  );
  if (relationships > worthReviewing.length) {
    lines.push(`${relationships} similarity relationships are contained in these groups.`);
  }

  return lines;
}

/**
 * Whether this group holds at least one relationship of a kind.
 *
 * The rule the filter row means. A group is a set of people connected through each other,
 * not one finding, so asking what it IS gives the wrong answer: a group whose strongest
 * relationship is the same machine can hold three structural ones as well, and a reader
 * looking for structural matches was being told there were none.
 *
 * `counts` is already the per-kind tally of the relationships in this group, so a group with
 * three structural relationships is one group here, not three.
 */
export function clusterHasType(cluster: MatchCluster, type: DisplayMatchType): boolean {
  // A common answer is a group of its own rather than a relationship inside one, so it is
  // the only kind that has to be asked about the group itself.
  if (type === 'common') return cluster.type === 'common';
  return cluster.counts[type] > 0;
}

/**
 * Every kind, in the page's own order. The filter row offers the first four; the last two are
 * counted for completeness and shown in the set-aside section rather than as filters.
 */
const ALL_TYPES: DisplayMatchType[] = [
  'byte-identical',
  'exact',
  'same-machine',
  'structural',
  'reference',
  'common',
];

/**
 * How many groups each filter would show, for the filter row's counts.
 *
 * Counted with the same rule that decides what a filter shows, so the number on a button and
 * the cards behind it can never disagree. The categories overlap by design: one group
 * holding two kinds of relationship is counted under both, so the parts do not add up to
 * `all` and are not meant to.
 */
export function countByType(clusters: MatchCluster[]): Record<DisplayMatchType | 'all', number> {
  const counts = {
    all: 0,
    'byte-identical': 0,
    exact: 0,
    'same-machine': 0,
    structural: 0,
    reference: 0,
    common: 0,
  } as Record<DisplayMatchType | 'all', number>;
  for (const cluster of clusters) {
    counts.all += 1;
    for (const type of ALL_TYPES) if (clusterHasType(cluster, type)) counts[type] += 1;
  }
  return counts;
}
