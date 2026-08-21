/**
 * Wording for the LMS link badges, kept apart from the queries that feed them.
 *
 * These run in the browser: the badge is rendered by client components on the course page and
 * the assignment page. Their sibling `links.ts` reads the database, so anything importing from
 * there drags Prisma into the client bundle, which the build refuses. Splitting the pure
 * functions out is the whole reason this file exists; keep it free of imports.
 */

/** One LMS course an assignment has been added to, as the screens receive it. */
export type LmsLinkSummary = {
  /** The `LtiDeepLink` row, so the screen listing these can remove one. */
  id: string;
  /** What to call the LMS: the registration's name, or its host if it was never named. */
  platform: string;
  /** What the LMS calls the course it was added to, when the launch told us. */
  context: string | null;
  addedAt: Date;
  /**
   * When the LMS first opened this link. Null while AFCT has sent a response and heard nothing
   * back, which is either a link waiting to be clicked or one the platform refused.
   */
  confirmedAt: Date | null;
  /** Who added it, when that account still exists. */
  addedBy: string | null;
};

/**
 * The platform's own name if it has one, otherwise its host.
 *
 * A registration created by hand always has a name. One created by dynamic registration is
 * named from the platform's configuration, which is usually the product name but is sometimes
 * missing, and "moodle.demovm.dev" is still more use to somebody reading a badge than a blank.
 */
export function platformLabel(platform: { name: string | null; issuer: string }): string {
  const named = platform.name?.trim();
  if (named) return named;
  try {
    return new URL(platform.issuer).host;
  } catch {
    // An issuer that is not a URL should not exist, but a badge is not the place to find out.
    return platform.issuer;
  }
}

/**
 * What a badge should say.
 *
 * One link names its LMS, because that is the useful fact and there is room for it. Several
 * are counted instead: a course cross-listed across three Canvas sections would otherwise
 * repeat the same word three times and push everything else out of the header.
 */
export function lmsBadgeLabel(links: Array<{ platform: string }>): string | null {
  const first = links[0];
  if (!first) return null;
  const names = new Set(links.map((link) => link.platform));
  if (links.length === 1) return `In ${first.platform}`;
  // One name in the set means every link names it, so the first one speaks for all of them.
  if (names.size === 1) return `In ${links.length} ${first.platform} courses`;
  return `In ${links.length} LMS courses`;
}

/**
 * The fuller sentence, for a tooltip and for the accessible name.
 *
 * The badge is short by design, so the detail that distinguishes two links (which LMS course
 * each one is) lives here rather than being lost.
 */
export function lmsLinkDescription(links: Array<{ platform: string; context: string | null }>) {
  return links.map((link) => (link.context ? `${link.context} in ${link.platform}` : link.platform));
}
