/**
 * What the standalone viewer remembers about a machine across a refresh.
 *
 * A reader zooms in on a corner of an automaton, drags two states apart to see an edge, and
 * then reloads the page: without this, all of that is gone and they start again from the fit.
 *
 * `sessionStorage`, deliberately. It survives a refresh, which is what was asked for, and it
 * goes when the window does, which matches the rest of the window's behaviour: closing a tab
 * already forgets its arrangement. It also means nothing is left on a shared office machine
 * naming which students' files somebody opened.
 *
 * Nothing here is authoritative. The submitted file is unchanged and is the record; this is a
 * view of it, and losing it costs a reader one fit.
 */

/**
 * The camera: how far in, and where over the machine.
 *
 * Its own type because it travels on its own when two panes are linked, without the positions
 * that the rest of the remembered view carries.
 */
export type ViewerViewport = { zoom: number; pan: { x: number; y: number } };

/** Where every state sits, plus the camera looking at it. */
export type ViewerViewState = {
  /** Bumped when the shape changes, so an old entry is ignored rather than misread. */
  v: 1;
  zoom: number;
  pan: { x: number; y: number };
  positions: Record<string, { x: number; y: number }>;
  /** Whether the reader was on the drawn layout or the auto-arranged one. */
  honorPositions: boolean;
};

const PREFIX = 'afct.viewer.view.';

const isPoint = (value: unknown): value is { x: number; y: number } => {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.x === 'number' &&
    Number.isFinite(p.x) &&
    typeof p.y === 'number' &&
    Number.isFinite(p.y)
  );
};

/** Reject anything that is not ours: the key is editable, and an old shape is not. */
function isViewState(value: unknown): value is ViewerViewState {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  if (s.v !== 1) return false;
  if (typeof s.zoom !== 'number' || !Number.isFinite(s.zoom) || s.zoom <= 0) return false;
  if (!isPoint(s.pan)) return false;
  if (typeof s.honorPositions !== 'boolean') return false;
  if (!s.positions || typeof s.positions !== 'object') return false;
  return Object.values(s.positions as Record<string, unknown>).every(isPoint);
}

export function readViewState(key: string | null | undefined): ViewerViewState | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isViewState(parsed) ? parsed : null;
  } catch {
    // Blocked storage, or a truncated entry. Opening at the fit is a fine answer.
    return null;
  }
}

export function writeViewState(key: string | null | undefined, state: ViewerViewState): void {
  if (!key || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify(state));
  } catch {
    // Full or blocked. Losing the view is not worth interrupting anybody over.
  }
}

export function clearViewState(key: string | null | undefined): void {
  if (!key || typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Whether a remembered arrangement belongs to the machine now on screen.
 *
 * Positions are keyed by state id, so putting one machine's arrangement onto another would
 * scatter states that happened to share a name and silently leave the rest where they were.
 * A saved entry is used only when every state it names is present.
 */
export function viewStateFits(state: ViewerViewState, nodeIds: readonly string[]): boolean {
  const ids = new Set(nodeIds);
  return Object.keys(state.positions).every((id) => ids.has(id));
}
