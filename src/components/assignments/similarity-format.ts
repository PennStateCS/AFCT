// The words the Similarity tab uses, in one place.
//
// Kept out of the components because they are the substance of the page rather than its
// layout: what a match is called, and what it is said to be, is the part an instructor
// reads and acts on. Implementation words (hash, fingerprint, sha256) never appear here;
// nor do verdicts.

import type { MatchSubmission } from '@/lib/similarity/matches';
import { MATCH_LABEL, isSetAside, type MatchCluster, type MatchType } from '@/lib/similarity/evidence';
import { subjectCountsOf, type ReviewSubject } from '@/lib/similarity/rarity';

// One definition of who a finding is about, shared with the rule that classifies a common
// answer: the words on the card and the threshold it is judged by have to agree.
export type { ReviewSubject };

/** "Attempt 3", or "Attempt unknown" when the numbering could not be worked out. */
export function attemptLabel(attempt: number | null): string {
  return attempt === null ? 'Attempt unknown' : `Attempt ${attempt}`;
}

/**
 * How many subjects a group involves, out of how many took the problem, and what to call
 * them. The same rule the commonality threshold is applied with, so the sentence on the card
 * and the classification behind it can never disagree.
 */
export function subjectCounts(
  cluster: MatchCluster,
  subject: ReviewSubject,
): { involved: number; total: number; noun: string } {
  const { sharing, total, noun } = subjectCountsOf(
    {
      studentCount: cluster.students.length,
      problemStudentCount: cluster.problemStudentCount,
      groupCount: cluster.groups.length,
      problemGroupCount: cluster.problemGroupCount,
    },
    subject,
  );
  return { involved: sharing, total, noun };
}

/** What the students in this problem were asked to build, in the reader's words. */
export function workNoun(problemType: string | null): string {
  if (problemType === 'CFG') return 'grammar';
  if (problemType === 'RE') return 'expression';
  if (problemType === 'FA' || problemType === 'PDA' || problemType === 'TM') return 'machine';
  return 'work';
}

/** "11 minutes", "1 hour 58 minutes", "3 days". Null when there is nothing to say. */
export function gapLabel(ms: number | null): string | null {
  if (ms === null) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    const hoursPart = `${hours} hour${hours === 1 ? '' : 's'}`;
    return rest === 0 ? hoursPart : `${hoursPart} ${rest} minute${rest === 1 ? '' : 's'}`;
  }

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** The short form used against each student after the first: "+11 min", "+1h 58m". */
export function elapsedLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return '+ under a min';
  if (minutes < 60) return `+${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest === 0 ? `+${hours}h` : `+${hours}h ${rest}m`;
  }
  return `+${Math.round(hours / 24)} days`;
}

/** What the autograder made of an attempt. Spelled out, never a colour on its own. */
export function resultLabel(correct: boolean | null): string {
  if (correct === true) return 'Correct';
  if (correct === false) return 'Incorrect';
  return 'Not graded';
}

export function studentName(student: MatchSubmission['student']): string {
  return `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() || 'Unknown student';
}


/** "9 states · 17 transitions", or nothing when the artifact carried no description. */
export function sizeLabel(cluster: {
  stateCount: number | null;
  transitionCount: number | null;
}): string | null {
  // A grammar or an expression has no states, and describing one as having none is worse
  // than saying nothing about its size.
  if (!cluster.stateCount) return null;
  const states = `${cluster.stateCount} state${cluster.stateCount === 1 ? '' : 's'}`;
  if (cluster.transitionCount === null) return states;
  return `${states} · ${cluster.transitionCount} transition${cluster.transitionCount === 1 ? '' : 's'}`;
}

/**
 * The strongest thing the detector can say about two files, when it can say it: their bytes
 * are the same. Null when it cannot.
 *
 * Every other check normalises something away first, so every other line needs a qualifier
 * ("once formatting is set aside", "with cosmetic differences"). This one needs none, which
 * is the whole reason it is worth a line of its own.
 *
 * Never said of the groups the page sets aside. On a grammar or an expression the expected
 * answer is routinely byte-identical across half the class, and everybody who was handed the
 * instructor's solution has it to the byte; putting the strongest wording on either is exactly
 * the overclaim those two categories exist to prevent. Also never said when the count is 1,
 * which covers both "no two agree" and "these were submitted before the file was hashed": the
 * page has no way to tell those apart, so it says nothing.
 */
export function byteIdenticalLine(cluster: MatchCluster): string | null {
  if (isSetAside(cluster.type)) return null;
  const identical = cluster.byteIdenticalStudentCount;
  if (identical < 2) return null;

  return identical >= cluster.students.length
    ? 'The files are byte-for-byte identical.'
    : `${identical} of them submitted byte-for-byte identical files.`;
}

/**
 * What can be said about the instructor's posted solution, at the level it is true at.
 *
 * All of a group being the posted solution and one relationship inside it being the posted
 * solution are different statements. The second one explains that pair and nothing else, so
 * it says which pair rather than tagging everybody connected to them.
 */
function answerFileLines(cluster: MatchCluster): string[] {
  // A reference-solution card says so in its heading and its first line; a third sentence
  // saying it again is noise.
  if (cluster.type === 'reference') return [];
  if (cluster.matchesAnswerFile) return ['Matches the instructor reference solution.'];
  if (cluster.answerFileRelationships === 0) return [];

  const n = cluster.answerFileRelationships;
  return [
    `${n} relationship${n === 1 ? '' : 's'} in this group ${n === 1 ? 'is' : 'are'} the instructor reference solution.`,
  ];
}

/**
 * The one line under the heading of a cluster: who, how many, and of how many.
 *
 * A group holding more than one relationship gets a neutral line instead of the strongest
 * relationship's claim. Students are gathered into a group by being connected to somebody in
 * it, not by all sharing the same thing: where Alice and Bob sent the same file and Bob and
 * Carol merely share structure, "3 students submitted the same saved machine" is false about
 * Carol. The kinds of relationship are listed underneath, and each one can be opened.
 */
export function clusterHeadline(cluster: MatchCluster, subject: ReviewSubject = 'student'): string {
  const { involved, total, noun } = subjectCounts(cluster, subject);
  const of = `${involved} of ${total} ${noun}${involved === 1 ? '' : 's'}`;

  if (cluster.relationships.length > 1) {
    const relationships = cluster.relationships.length;
    return `${of} are connected by ${relationships} similarity relationship${relationships === 1 ? '' : 's'}`;
  }

  if (cluster.type === 'reference') {
    return `${of} submitted the ${workNoun(cluster.problem.type)} the instructor posted`;
  }
  if (cluster.type === 'exact') {
    return `${of} submitted the same saved ${workNoun(cluster.problem.type)}`;
  }
  if (cluster.type === 'same-machine') {
    return `${of} submitted the same ${workNoun(cluster.problem.type)} with cosmetic differences`;
  }
  if (cluster.type === 'structural') {
    return `${of} share uncommon structure in their ${workNoun(cluster.problem.type)}s`;
  }
  return `${of} submitted this same work`;
}

/**
 * The lines under that, each of which the implementation can substantiate.
 *
 * An exact match may say the saved coordinates agree because the fingerprint covers them: it
 * is the same normalised artifact, layout and all. Nothing here claims anything the detector
 * did not compute.
 */
export function clusterDetails(cluster: MatchCluster): string[] {
  const lines: string[] = [];

  const byteLine = byteIdenticalLine(cluster);

  // More than one relationship means the students were gathered by being connected to
  // somebody, not by all sharing one thing, so there is no single claim to make about them.
  // What the group is made of, said as sentences, and then only the facts that hold whoever
  // is being described.
  if (cluster.relationships.length > 1) {
    lines.push(
      ...relationshipSummary(cluster).map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}.`),
    );
    if (byteLine) lines.push(byteLine);
    const groupGap = gapLabel(cluster.closestGapMs);
    if (groupGap) lines.push(`Closest submissions were ${groupGap} apart.`);
    lines.push(...answerFileLines(cluster));
    return [...new Set(lines)];
  }

  if (cluster.type === 'exact') {
    // Strongest first: if the bytes agree there is nothing to qualify, and the lines below
    // are the weaker version of the same statement.
    if (byteLine) lines.push(byteLine);
    // A grammar or an expression has no drawing to agree on, so saying the coordinates
    // match would be describing something that does not exist.
    lines.push(
      cluster.stateCount
        ? 'The structure and the saved drawing coordinates are identical.'
        : 'The contents are identical once formatting is set aside.',
    );
    if (cluster.stateCount !== null && cluster.stateCount > 0) {
      lines.push(
        `All ${cluster.stateCount} state position${cluster.stateCount === 1 ? '' : 's'} are identical.`,
      );
    }
  }

  if (cluster.type === 'same-machine') {
    lines.push('State names or positions differ.');
    const exact = cluster.relationships.filter(
      (group) => group.identicalStudentCount > 1 && group.kind === 'same-work',
    ).length;
    // The byte line replaces the content-level one rather than joining it: two adjacent
    // sentences saying nearly the same thing at different strictness is worse than either.
    if (byteLine) {
      lines.push(byteLine);
    } else if (exact > 0) {
      lines.push('Some of them submitted the same file, once formatting is set aside.');
    }
  }

  if (cluster.type === 'structural') {
    lines.push(...cluster.relationships.flatMap((group) => group.evidence));
  }

  if (cluster.type === 'reference') {
    // Nothing about how alike the files are, because that is not what this card is about:
    // everybody who was given the solution has it, and that explains the match by itself.
    lines.push('This work is the solution the instructor posted for this problem.');
  }

  if (cluster.type === 'common') {
    lines.push('Submitted by enough of the class to be the expected answer.');
  }

  const gap = gapLabel(cluster.closestGapMs);
  if (gap && cluster.type !== 'common') lines.push(`Closest submissions were ${gap} apart.`);

  lines.push(...answerFileLines(cluster));

  return [...new Set(lines)];
}

/** "Alice and Bob", "Group 4, Group 7 and Group 9": a list a person reads. */
function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Who one relationship is between, named the way the page names its subjects.
 *
 * Deliberately not assumed to be a pair: a same-work relationship is every submission
 * sharing that work, which can be three students or three teams.
 */
export function relationshipParties(
  relationship: MatchCluster['relationships'][number],
  subject: ReviewSubject,
): string {
  const names =
    subject === 'group'
      ? relationship.submissions.map((s) => s.studentGroup?.name ?? studentName(s.student))
      : relationship.submissions.map((s) => studentName(s.student));
  return listOf([...new Set(names)]);
}

/** "Attempt 2", "Attempts 1 and 3". Null when no attempt number could be worked out. */
export function relationshipAttempts(
  relationship: MatchCluster['relationships'][number],
): string | null {
  const numbers = [
    ...new Set(
      relationship.submissions
        .map((s) => s.attempt)
        .filter((attempt): attempt is number => attempt !== null),
    ),
  ].sort((a, b) => a - b);
  if (numbers.length === 0) return null;
  return numbers.length === 1
    ? `Attempt ${numbers[0]}`
    : `Attempts ${listOf(numbers.map(String))}`;
}

/** What the group is made of, for a cluster holding more than one relationship. */
export function relationshipSummary(cluster: MatchCluster): string[] {
  const parts: string[] = [];
  // Lowercased to sit inside a sentence, except JFLAP, which is a name.
  const say = (count: number, kind: MatchType) =>
    `${count} ${MATCH_LABEL[kind].toLowerCase().replace('jflap', 'JFLAP')} relationship${count === 1 ? '' : 's'}`;

  if (cluster.counts.exact > 0) parts.push(say(cluster.counts.exact, 'exact'));
  if (cluster.counts['same-machine'] > 0) {
    parts.push(say(cluster.counts['same-machine'], 'same-machine'));
  }
  if (cluster.counts.structural > 0) parts.push(say(cluster.counts.structural, 'structural'));
  if (cluster.counts.reference > 0) parts.push(say(cluster.counts.reference, 'reference'));
  return parts;
}

/** The facts an info popover repeats back about this particular match. */
export function clusterFacts(cluster: MatchCluster, subject: ReviewSubject = 'student'): string[] {
  const { involved, total, noun } = subjectCounts(cluster, subject);
  const facts = [`${involved} of ${total} ${noun}${involved === 1 ? '' : 's'} are involved`];

  const size = sizeLabel(cluster);
  if (size) facts.push(size);

  // The card only shows `clusterDetails` for a cluster holding one relationship, so without
  // this the byte line would be missing from exactly the multi-student groups most worth
  // reading. Stated without the full stop, like the other facts.
  const byteLine = byteIdenticalLine(cluster);
  if (byteLine) facts.push(byteLine.replace(/\.$/, ''));

  const gap = gapLabel(cluster.closestGapMs);
  if (gap) facts.push(`The closest two submissions were ${gap} apart`);

  if (cluster.relationships.length > 1) {
    facts.push(...relationshipSummary(cluster).map((part) => part[0]!.toUpperCase() + part.slice(1)));
  }

  facts.push(...answerFileLines(cluster).map((line) => line.replace(/\.$/, '')));

  return facts;
}
