// How common a match is, kept apart from the matching itself.
//
// Deliberately a module of its own with no imports: the Similarity panel is a client
// component and needs this rule, while `matches.ts` reaches for Prisma. Importing the rule
// from there dragged the Postgres driver into the browser bundle, which is a build error
// waiting on a `dns` module that does not exist there.

/**
 * Past this share of a problem's students, identical work is what a correct answer looks
 * like rather than a finding.
 *
 * A starting point rather than a truth: the right number depends on the problem and on the
 * course, which is why the panel lets a reader move it. It is the default the tab badge
 * counts with, and what the panel opens on before anybody touches the dial.
 */
export const COMMON_SHARE = 0.25;

export function isCommon(
  group: { studentCount: number; problemStudentCount: number },
  share: number = COMMON_SHARE,
): boolean {
  return group.problemStudentCount > 0 && group.studentCount / group.problemStudentCount >= share;
}
