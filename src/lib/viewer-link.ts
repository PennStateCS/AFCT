/**
 * Links from the in-app viewer dialogs to the standalone viewer window.
 *
 * The standalone page never accepts a URL to fetch. It is given a file *kind* and a bare
 * file name and builds the request itself, so a hand-edited link cannot point the viewer
 * at somewhere else. This module owns both halves of that contract: turning a dialog's
 * `src` into a link, and reading the pieces back out on the page.
 */

import { isSafeUploadName } from '@/lib/upload-names';

/** The upload stores a viewer may read from. Each has its own authorisation and audit. */
export const VIEWER_FILE_KINDS = ['submissions', 'problems', 'solutions'] as const;
export type ViewerFileKind = (typeof VIEWER_FILE_KINDS)[number];

/** Where the standalone viewer lives. Outside `/dashboard`, so it has no sidebar. */
export const VIEWER_PATH = '/viewer';

/**
 * The window name reused for every pop-out.
 *
 * Named rather than blank so a second click focuses the window that is already open
 * instead of scattering windows across the desktop. A consequence worth knowing: opening
 * a *different* machine navigates that same window rather than adding to it. One pop-out,
 * latest machine wins, which is the whole of this phase.
 */
export const VIEWER_WINDOW_NAME = 'afct-viewer';

export function isViewerFileKind(value: unknown): value is ViewerFileKind {
  return typeof value === 'string' && (VIEWER_FILE_KINDS as readonly string[]).includes(value);
}

/** The file route a kind and name resolve to. The page builds this; the URL never carries it. */
export function viewerFileSrc(kind: ViewerFileKind, file: string): string {
  return `/api/files/${kind}/${encodeURIComponent(file)}`;
}

/**
 * The published documentation for this viewer.
 *
 * The trailing slash is the canonical form: without it GitHub Pages answers 301 and the browser
 * takes a needless extra round trip. Pointed at the page that describes the viewer rather than
 * the site root, because somebody opening Help from here has a question about this window.
 */
export const VIEWER_DOCS_URL = 'https://pennstatecs.github.io/AFCT/admin/submissions/';

/**
 * Read a viewer dialog's `src` back into the pieces the standalone window needs.
 *
 * Returns null for anything that is not one of this application's own file routes, an absolute
 * URL included: the viewer reads from those routes and nowhere else, and a name that is not a
 * plain basename is refused here rather than at the far end.
 */
export function parseViewerSrc(src: string): { kind: ViewerFileKind; file: string } | null {
  const match = /^\/api\/files\/([a-z]+)\/([^/?#]+)$/.exec(src.trim());
  if (!match) return null;

  const kind = match[1];
  const rawFile = match[2];
  if (!isViewerFileKind(kind) || rawFile === undefined) return null;

  let file: string;
  try {
    file = decodeURIComponent(rawFile);
  } catch {
    // A malformed escape sequence. Nothing safe to build from.
    return null;
  }
  if (!isSafeUploadName(file)) return null;
  return { kind, file };
}

type ViewerLinkArgs = {
  /** The `src` a viewer dialog was given, expected to be one of the file routes. */
  src: string;
  problemType: string | null | undefined;
  title?: string;
  /**
   * The file's own name, as its author would recognise it.
   *
   * Separate from `title`, which is a composed heading ("answer.jff - D Flip-Flop"). The tab
   * in the standalone window wants the name alone. Passed explicitly rather than split back
   * out of the title, because a file name is allowed to contain the separator too.
   */
  fileName?: string;
  epsSymbol?: string;
};

/**
 * A link to the standalone viewer for the same file, or null when one cannot be built.
 *
 * Returning null is the graceful path, not an error: the caller simply does not offer the
 * button. That happens for a `src` this viewer does not recognise (anything that is not one
 * of the three file routes, including an absolute URL), and for a file name that is not a
 * plain basename. Both are refused here rather than at the far end, so a link that exists
 * always works.
 */
export function viewerWindowHref({
  src,
  problemType,
  title,
  fileName,
  epsSymbol,
}: ViewerLinkArgs): string | null {
  const type = (problemType ?? '').trim();
  if (!type) return null;

  const parsed = parseViewerSrc(src);
  if (!parsed) return null;
  const { kind, file } = parsed;

  const params = new URLSearchParams({ kind, file, type });
  if (title) params.set('title', title);
  if (fileName) params.set('name', fileName);
  if (epsSymbol) params.set('eps', epsSymbol);
  return `${VIEWER_PATH}?${params.toString()}`;
}
