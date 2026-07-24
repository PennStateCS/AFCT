/**
 * Shared display strings for the assignment audience and override editors, so the two
 * surfaces that list groups describe them identically.
 */

/** "1 member" / "3 members", treating an unknown count as zero. */
export function memberCountLabel(count: number | undefined): string {
  const n = count ?? 0;
  return `${n} ${n === 1 ? 'member' : 'members'}`;
}
