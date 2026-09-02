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

/**
 * What the reader had open, so the properties panel comes back with the view.
 *
 * A transition is named by its two ends rather than by an element id, because the ids the
 * drawing uses are positional (`e3-q0-q1`) and would move if the file were reordered. The pair
 * is what the panel asks about anyway: parallel transitions between the same two states are one
 * line on the canvas.
 */
export type ViewerSelection =
  | { kind: 'state'; id: string }
  | { kind: 'transition'; from: string; to: string };

/** Where every state sits, plus the camera looking at it. */
export type ViewerViewState = {
  /** Bumped when the shape changes, so an old entry is ignored rather than misread. */
  v: 1;
  zoom: number;
  pan: { x: number; y: number };
  positions: Record<string, { x: number; y: number }>;
  /** Whether the reader was on the drawn layout or the auto-arranged one. */
  honorPositions: boolean;
  /**
   * Whether the reader had moved anything, as opposed to looking at the file as it came.
   *
   * Optional so an entry written before this existed still opens: the view is worth more than
   * the flag, and the worst it costs is an indicator that stays quiet for one session.
   */
  modified?: boolean;
  /**
   * The state or transition whose properties were open, if any.
   *
   * Optional for the same reason as `modified`: an entry written before this existed still
   * opens, and the worst it costs is a panel the reader has to click again.
   */
  selection?: ViewerSelection | null;
  /**
   * The names the reader has given states, by state id.
   *
   * Kept for the same reason as the positions: a reader who renames three states to follow an
   * argument and then reloads should not lose the argument. Optional, like the two above, so an
   * entry written before this existed still opens.
   */
  renames?: Record<string, string>;
  /**
   * The state the reader has made the initial one, if they have said anything about it.
   *
   * Absent means the file's own answer stands. A string is the state they chose, and null is
   * "none", which is what unticking the box asks for. Three answers rather than two, because
   * "they have not touched it" and "they have taken it away" are different things to come back
   * to after a refresh.
   */
  initialState?: string | null;
  /**
   * Which states the reader has made final, or unmade, by state id.
   *
   * A map rather than a single id, because unlike the initial state a machine can have any
   * number of final ones: this says what the reader changed, and every state it does not name
   * keeps the file's own answer.
   */
  finals?: Record<string, boolean>;
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

function isSelection(value: unknown): value is ViewerSelection {
  if (!value || typeof value !== 'object') return false;
  const sel = value as Record<string, unknown>;
  if (sel.kind === 'state') return typeof sel.id === 'string' && sel.id.length > 0;
  if (sel.kind === 'transition') return typeof sel.from === 'string' && typeof sel.to === 'string';
  return false;
}

/** Reject anything that is not ours: the key is editable, and an old shape is not. */
function isViewState(value: unknown): value is ViewerViewState {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  if (s.v !== 1) return false;
  if (typeof s.zoom !== 'number' || !Number.isFinite(s.zoom) || s.zoom <= 0) return false;
  if (!isPoint(s.pan)) return false;
  if (typeof s.honorPositions !== 'boolean') return false;
  if (s.modified !== undefined && typeof s.modified !== 'boolean') return false;
  if (s.selection !== undefined && s.selection !== null && !isSelection(s.selection)) return false;
  if (
    s.initialState !== undefined &&
    s.initialState !== null &&
    typeof s.initialState !== 'string'
  ) {
    return false;
  }
  if (s.finals !== undefined) {
    if (!s.finals || typeof s.finals !== 'object') return false;
    if (!Object.values(s.finals as Record<string, unknown>).every((v) => typeof v === 'boolean')) {
      return false;
    }
  }
  if (s.renames !== undefined) {
    if (!s.renames || typeof s.renames !== 'object') return false;
    if (!Object.values(s.renames as Record<string, unknown>).every((v) => typeof v === 'string')) {
      return false;
    }
  }
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
