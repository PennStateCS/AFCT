import { isSafeUploadName } from '@/lib/upload-names';
import {
  isViewerFileKind,
  parseViewerSrc,
  viewerWindowHref,
  type ViewerFileKind,
} from '@/lib/viewer-link';

/**
 * The tabs open in a standalone viewer window.
 *
 * The list lives in the URL, which is what makes a refresh restore the same set and a pasted
 * link open the same set for a colleague. Nothing about a tab is stored anywhere else, and a
 * tab holds only an identity: the bytes are fetched when it becomes the active tab and not
 * before, so one look at a student's work is one `VIEW_SUBMISSION_FILE` record rather than one
 * per tab per refresh.
 */
export type ViewerTab = {
  kind: ViewerFileKind;
  /** The stored file name, already known safe. */
  file: string;
  /** Problem type, which selects the renderer. */
  type: string;
  /** What the tab is labelled with. */
  name: string;
  /** The longer heading, used as the graph's accessible name. */
  title: string;
  /** The course's empty-string symbol. */
  eps?: string;
};

/**
 * How many tabs a window will hold.
 *
 * Past a dozen the strip is unreadable and nobody is comparing that many anyway. The cap also
 * keeps the URL, which carries every tab, comfortably short.
 */
export const MAX_VIEWER_TABS = 12;

/** Two tabs are the same tab when they name the same stored file. */
export const sameTab = (a: ViewerTab, b: ViewerTab) => a.kind === b.kind && a.file === b.file;

/** The channel a viewer window listens on, and the key its heartbeat is written under. */
export const VIEWER_CHANNEL = 'afct-viewer';
export const VIEWER_ALIVE_KEY = 'afct.viewer.alive';
/** A heartbeat older than this means no viewer window is listening. */
export const VIEWER_ALIVE_TIMEOUT_MS = 6000;

/** Reject anything that did not come from us, since the URL is user-editable. */
function isTab(value: unknown): value is ViewerTab {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return (
    isViewerFileKind(t.kind) &&
    typeof t.file === 'string' &&
    isSafeUploadName(t.file) &&
    typeof t.type === 'string' &&
    t.type.length > 0 &&
    typeof t.name === 'string' &&
    typeof t.title === 'string' &&
    (t.eps === undefined || typeof t.eps === 'string')
  );
}

/**
 * Read the tab list out of a URL's search params.
 *
 * Falls back to the single-file parameters when there is no list, so links made before tabs
 * existed, and any a reader has bookmarked, still open.
 */
export function readTabs(params: URLSearchParams): ViewerTab[] {
  const raw = params.get('tabs');
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const tabs = parsed.filter(isTab).slice(0, MAX_VIEWER_TABS);
        // Duplicates would give two tabs that cannot be told apart and double the audit trail.
        return tabs.filter((tab, i) => tabs.findIndex((other) => sameTab(tab, other)) === i);
      }
    } catch {
      // A hand-edited or truncated URL. Fall through to the single-file form.
    }
  }

  const kind = params.get('kind');
  const file = params.get('file');
  const type = (params.get('type') ?? '').toUpperCase();
  if (!isViewerFileKind(kind) || !isSafeUploadName(file) || !type) return [];
  const title = params.get('title') ?? file;
  return [
    {
      kind,
      file,
      type,
      name: params.get('name') ?? title,
      title,
      eps: params.get('eps') ?? undefined,
    },
  ];
}

/** Which tab is showing, clamped to the list so a hand-edited index cannot select nothing. */
export function readActiveIndex(params: URLSearchParams, tabCount: number): number {
  const raw = Number(params.get('active') ?? '0');
  if (!Number.isInteger(raw) || raw < 0 || raw >= tabCount) return 0;
  return raw;
}

/** The query string for a set of tabs, for `history.replaceState`. */
export function tabsToSearch(tabs: ViewerTab[], activeIndex: number): string {
  const params = new URLSearchParams();
  params.set('tabs', JSON.stringify(tabs));
  params.set('active', String(Math.max(0, Math.min(activeIndex, tabs.length - 1))));
  return params.toString();
}

/**
 * Add a tab, or select it if it is already open.
 *
 * Opening something twice must not produce two identical tabs: the reader would have no way to
 * tell them apart, and each would report its own view of the same file.
 */
export function withTab(
  tabs: ViewerTab[],
  next: ViewerTab,
): { tabs: ViewerTab[]; activeIndex: number } {
  const existing = tabs.findIndex((tab) => sameTab(tab, next));
  if (existing >= 0) return { tabs, activeIndex: existing };
  if (tabs.length >= MAX_VIEWER_TABS) {
    // Full. Replace the oldest rather than refusing, which would look like the button broke.
    const trimmed = [...tabs.slice(1), next];
    return { tabs: trimmed, activeIndex: trimmed.length - 1 };
  }
  return { tabs: [...tabs, next], activeIndex: tabs.length };
}

/** Remove a tab, keeping something sensible selected. */
export function withoutTab(
  tabs: ViewerTab[],
  index: number,
  activeIndex: number,
): { tabs: ViewerTab[]; activeIndex: number } {
  if (index < 0 || index >= tabs.length) return { tabs, activeIndex };
  const remaining = tabs.filter((_, i) => i !== index);
  if (remaining.length === 0) return { tabs: remaining, activeIndex: 0 };
  // Closing the active tab selects its neighbour; closing one before it keeps the same tab
  // selected rather than sliding the selection along with the indices.
  const nextActive =
    index < activeIndex ? activeIndex - 1 : Math.min(activeIndex, remaining.length - 1);
  return { tabs: remaining, activeIndex: nextActive };
}

/** Where the pop-out button sends a file: a link for a new window, a tab for an open one. */
export type ViewerWindowTarget = { href: string; tab: ViewerTab };

/**
 * Everything a dialog needs to hand a file to the standalone window, or null when it cannot.
 *
 * Both halves come from the same parse, so the link and the tab can never describe different
 * files: opening a window and adding a tab to one already open must land on the same thing.
 */
export function viewerWindowTarget(args: {
  src: string;
  problemType: string | null | undefined;
  title?: string;
  fileName?: string;
  epsSymbol?: string;
}): ViewerWindowTarget | null {
  const href = viewerWindowHref(args);
  const parsed = parseViewerSrc(args.src);
  const type = (args.problemType ?? '').trim();
  if (!href || !parsed || !type) return null;

  const title = args.title ?? parsed.file;
  return {
    href,
    tab: {
      kind: parsed.kind,
      file: parsed.file,
      type,
      name: args.fileName ?? title,
      title,
      eps: args.epsSymbol,
    },
  };
}
