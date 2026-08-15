// The words the Similarity tab uses, in one place.
//
// Kept out of the components because they are the substance of the page rather than its
// layout: what a match is called, and what it is said to be, is the part an instructor
// reads and acts on. Implementation words (hash, fingerprint, sha256) never appear here;
// nor do verdicts.

import type { SubmissionMatchGroup, MatchSubmission } from '@/lib/similarity/matches';

/** What the students in this problem were asked to build, in the reader's words. */
export function workNoun(problemType: string | null): string {
  if (problemType === 'CFG') return 'grammar';
  if (problemType === 'RE') return 'expression';
  if (problemType === 'FA' || problemType === 'PDA' || problemType === 'TM') return 'machine';
  return 'work';
}

/** The heading of a match card: what kind of match it is, in three words or so. */
export function matchTitle(group: SubmissionMatchGroup): string {
  if (group.identicalStudentCount >= group.studentCount) return 'Identical file';
  if (group.identicalStudentCount > 1) return 'Same work';
  return 'Same work, drawn differently';
}

/** The one line under the heading: the counts, which are what the match means. */
export function matchHeadline(group: SubmissionMatchGroup): string {
  const of = `${group.studentCount} of ${group.problemStudentCount} students submitted`;
  if (group.identicalStudentCount >= group.studentCount) {
    return `${of} the identical file`;
  }
  return `${of} the same ${workNoun(group.problem.type)}`;
}

/** The quieter lines after it: what differs, how close together, where it came from. */
export function matchDetails(group: SubmissionMatchGroup): string[] {
  const lines: string[] = [];

  if (group.identicalStudentCount > 1 && group.identicalStudentCount < group.studentCount) {
    lines.push(`${group.identicalStudentCount} of them submitted the identical file.`);
  } else if (group.identicalStudentCount <= 1) {
    lines.push('State names or positions differ.');
  }

  const gap = gapLabel(group.closestGapMs);
  if (gap) lines.push(`Closest submissions were ${gap} apart.`);

  return lines;
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

/** One entry per student, earliest first, counted from their earliest attempt at it. */
export function studentsInOrder(group: SubmissionMatchGroup): MatchSubmission[] {
  const earliest = new Map<string, MatchSubmission>();
  for (const submission of group.submissions) {
    const held = earliest.get(submission.student.id);
    if (!held || submission.submittedAt < held.submittedAt) {
      earliest.set(submission.student.id, submission);
    }
  }
  return [...earliest.values()].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

export function studentName(student: MatchSubmission['student']): string {
  return `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() || 'Unknown student';
}

/**
 * The page's opening sentence, which is the whole point of the top of the tab: does the
 * reader need to look at anything, and is any of it the serious kind.
 */
export function summarise(worthReviewing: SubmissionMatchGroup[], common: number): string[] {
  if (worthReviewing.length === 0 && common === 0) {
    return ['No two students submitted matching work.'];
  }

  if (worthReviewing.length === 0) {
    return [
      `No matches worth reviewing. ${common} common answer${common === 1 ? '' : 's'} set aside.`,
    ];
  }

  const problems = new Set(worthReviewing.map((group) => group.problem.id)).size;
  const lines = [
    `${worthReviewing.length} match${worthReviewing.length === 1 ? '' : 'es'} worth reviewing across ` +
      `${problems} problem${problems === 1 ? '' : 's'}.`,
  ];

  const reused = worthReviewing.filter((group) => group.reusedAfterPass).length;
  if (reused > 0) {
    lines.push(
      `${reused} include${reused === 1 ? 's' : ''} work reused after another student received a correct result.`,
    );
  }
  return lines;
}
