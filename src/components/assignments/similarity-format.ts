// The words the Similarity tab uses, in one place.
//
// Kept out of the components because they are the substance of the page rather than its
// layout: what a match is called, and what it is said to be, is the part an instructor
// reads and acts on. Implementation words (hash, fingerprint, sha256) never appear here;
// nor do verdicts.

import type { MatchSubmission } from '@/lib/similarity/matches';
import { MATCH_LABEL, type MatchCluster, type MatchType } from './similarity-evidence';

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
  if (cluster.stateCount === null) return null;
  const states = `${cluster.stateCount} state${cluster.stateCount === 1 ? '' : 's'}`;
  if (cluster.transitionCount === null) return states;
  return `${states} · ${cluster.transitionCount} transition${cluster.transitionCount === 1 ? '' : 's'}`;
}

/** The one line under the heading of a cluster: who, how many, and of how many. */
export function clusterHeadline(cluster: MatchCluster): string {
  const students = cluster.students.length;
  const of = `${students} of ${cluster.problemStudentCount} students`;

  if (cluster.type === 'exact') return `${of} submitted the same saved machine`;
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

  if (cluster.type === 'exact') {
    lines.push('The machine structure and the saved drawing coordinates are identical.');
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
    if (exact > 0) {
      lines.push(`Some of them submitted the identical saved artifact.`);
    }
  }

  if (cluster.type === 'structural') {
    lines.push(...cluster.relationships.flatMap((group) => group.evidence));
  }

  if (cluster.type === 'common') {
    lines.push('Submitted by enough of the class to be the expected answer.');
  }

  const gap = gapLabel(cluster.closestGapMs);
  if (gap && cluster.type !== 'common') lines.push(`Closest submissions were ${gap} apart.`);

  if (cluster.matchesAnswerFile) lines.push('Matches the instructor reference solution.');

  return [...new Set(lines)];
}

/** What the group is made of, for a cluster holding more than one relationship. */
export function relationshipSummary(cluster: MatchCluster): string[] {
  const parts: string[] = [];
  const say = (count: number, kind: MatchType) =>
    `${count} ${MATCH_LABEL[kind].toLowerCase()} relationship${count === 1 ? '' : 's'}`;

  if (cluster.counts.exact > 0) parts.push(say(cluster.counts.exact, 'exact'));
  if (cluster.counts['same-machine'] > 0) {
    parts.push(say(cluster.counts['same-machine'], 'same-machine'));
  }
  if (cluster.counts.structural > 0) parts.push(say(cluster.counts.structural, 'structural'));
  return parts;
}

/** The facts an info popover repeats back about this particular match. */
export function clusterFacts(cluster: MatchCluster): string[] {
  const facts = [`${cluster.students.length} of ${cluster.problemStudentCount} students are involved`];

  const size = sizeLabel(cluster);
  if (size) facts.push(size);

  const gap = gapLabel(cluster.closestGapMs);
  if (gap) facts.push(`The closest two submissions were ${gap} apart`);

  if (cluster.relationships.length > 1) {
    facts.push(...relationshipSummary(cluster).map((part) => part[0]!.toUpperCase() + part.slice(1)));
  }

  if (cluster.matchesAnswerFile) facts.push('The work is the problem\'s own reference solution');

  return facts;
}
