// How common a match is, kept apart from the matching itself.
//
// Deliberately a module of its own with no imports: the Similarity panel is a client
// component and needs this rule, while `matches.ts` reaches for Prisma. Importing the rule
// from there dragged the Postgres driver into the browser bundle, which is a build error
// waiting on a `dns` module that does not exist there.

/**
 * Who a finding is about, which is also what rarity is measured against.
 *
 * On a group assignment any member may submit for the team, so counting members would make
 * a class of nine teams look like a class of thirty students and would rate work shared by
 * two teams as rarer than it is. The subject comes from the assignment (it has a group set
 * or it does not), never from guessing at the rows.
 */
export type ReviewSubject = 'student' | 'group';

/** How many subjects share this work, out of how many took the problem, and their name. */
export type SubjectCounts = { sharing: number; total: number; noun: ReviewSubject };

/**
 * Pick the counts to judge a match by.
 *
 * Groups when the assignment is group work AND the submissions actually carry a group,
 * students otherwise. The second half of that matters: work submitted before AFCT recorded
 * groups has no team identity, and a ratio mixing a group numerator with a student
 * denominator would be a number about nothing. Better a true statement about students.
 */
export function subjectCountsOf(
  counts: {
    studentCount: number;
    problemStudentCount: number;
    groupCount?: number;
    problemGroupCount?: number;
  },
  subject: ReviewSubject = 'student',
): SubjectCounts {
  if (subject === 'group' && (counts.groupCount ?? 0) > 0 && (counts.problemGroupCount ?? 0) > 0) {
    return {
      sharing: counts.groupCount as number,
      total: counts.problemGroupCount as number,
      noun: 'group',
    };
  }
  return { sharing: counts.studentCount, total: counts.problemStudentCount, noun: 'student' };
}

/**
 * Past this share of a problem's subjects, identical work is what a correct answer looks
 * like rather than a finding.
 *
 * A starting point rather than a truth: the right number depends on the problem and on the
 * course, which is why the panel lets a reader move it. It is the default the tab badge
 * counts with, and what the panel opens on before anybody touches the dial.
 */
export const COMMON_SHARE = 0.25;

export function isCommon(
  group: {
    studentCount: number;
    problemStudentCount: number;
    groupCount?: number;
    problemGroupCount?: number;
  },
  share: number = COMMON_SHARE,
  subject: ReviewSubject = 'student',
): boolean {
  const { sharing, total } = subjectCountsOf(group, subject);
  return total > 0 && sharing / total >= share;
}
