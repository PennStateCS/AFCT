/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  bestLoopDirection,
  bestStartMarkerDirection,
  edgeLabelOffset,
  loopLabelOffset,
  startMarkerPolygon,
  startMarkerPosition,
  FINAL_STATE_BORDER_WIDTH,
  LABEL_LINE_HEIGHT,
  LOOP_REACH,
  NODE_DIAMETER,
  NOTE_FONT_SIZE,
  NOTE_MAX_WIDTH,
  START_MARKER_SIZE,
  STATE_BORDER_WIDTH,
} from '@/lib/jflap-layout';
import { toJflapXml } from '@/lib/jflap-write';
import {
  clearViewState,
  readViewState,
  writeViewState,
  viewStateFits,
  type ViewerViewState,
} from '@/lib/viewer-view-state';
import {
  describeMachine,
  describeEdge,
  describeState,
  machineDescriptionText,
  parseJflap,
  toElements,
  type MachineType,
  type Parsed,
} from '@/lib/jflap-parse';

/* ───────────────────────────── Types & consts ───────────────────────────── */

/*
 * JFLAP's own palette, read out of the `gui` classes in `jars/afct-evaluator.jar` rather
 * than eyeballed, so a student sees the same automaton here as in the desktop tool:
 *
 *   gui/viewer/StateDrawer.STATE_COLOR      = Color(255, 255, 150)  the state fill
 *   gui/viewer/StateDrawer.HIGHLIGHT_COLOR  = Color(100, 200, 200)
 *   gui/Globals.FROM_COLOR                  = Color( 37,  99, 235)  the selection blue
 *
 * JFLAP draws the outline and the state's own name in black on that fill, which reads
 * correctly on either theme because it sits INSIDE the yellow circle.
 *
 * These are literals, not `var(--node-color)`. Cytoscape renders to canvas and parses
 * colours itself; it does not understand the `oklch()` this app's tokens are written in,
 * so every one of those custom properties was silently rejected and the states fell back
 * to cytoscape's default grey. That is why they were grey rather than the yellow the
 * token already specified.
 */
const STATE_FILL = '#ffff96';
const STATE_STROKE = '#000000';
const STATE_TEXT = '#000000';
const HIGHLIGHT_COLOR = '#2563eb';

const NODE_FILL = STATE_FILL;

const EDGE_WIDTH = 1.6;
export const DEFAULT_EPS = 'ε';

/* ─────────────────────── Cytoscape + ELK (lazy load) ───────────────────── */

let cyPkg: any = null;
let initDone = false;

async function ensureCytoscapeReady() {
  if (!cyPkg) {
    const cytoscape = (await import('cytoscape')).default;
    cyPkg = cytoscape;
  }
  if (!initDone) {
    const elk = (await import('cytoscape-elk')).default;
    const svgExt = (await import('cytoscape-svg')).default;
    cyPkg.use(elk);
    cyPkg.use(svgExt);
    initDone = true;
  }
  return cyPkg;
}

/* ────────────────────────────── Export helpers ─────────────────────────── */

async function downloadDataUrl(filename: string, dataUrl: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

// Debounce utility for resize
function debounce(fn: () => void, ms: number) {
  let timer: any;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

// Where every transition label has ended up, for the things that have to dodge them.
// Only meaningful once `updateEdgeLabelMargins` has run.
function edgeLabelAnchors(cy: any): { x: number; y: number }[] {
  return cy
    .edges()
    .filter((e: any) => e.data('isLoop') !== 1 && String(e.data('label') ?? '') !== '')
    .map((e: any) => {
      const mid = e.midpoint();
      const off = edgeLabelOffset(e.source().position(), e.target().position(), mid);
      return { x: mid.x + off.x, y: mid.y + off.y };
    });
}

// The ground this state's self-loops cover: the far side of each loop and where its label
// sits. A loop is a wide arc rather than a line, so an angle alone describes it badly and
// left the initial-state marker grazing one; these are the two points it actually has to
// keep away from. `selfLoopGeometry` records the direction it chose, so this is only
// meaningful once that has run.
function selfLoopObstacles(node: any): { x: number; y: number }[] {
  const nodePos = node.position();
  const points: { x: number; y: number }[] = [];

  node
    .connectedEdges()
    .filter((e: any) => e.data('isLoop') === 1 && typeof e.data('loopDirection') === 'number')
    .forEach((e: any) => {
      const degrees = e.data('loopDirection');
      const angle = ((degrees - 90) * Math.PI) / 180;
      const apex = {
        x: nodePos.x + Math.cos(angle) * LOOP_REACH,
        y: nodePos.y + Math.sin(angle) * LOOP_REACH,
      };
      const lines = String(e.data('label') ?? '').split('\n').length;
      const labelOffset = loopLabelOffset(degrees, lines);
      points.push(apex, { x: apex.x + labelOffset.x, y: apex.y + labelOffset.y });
    });

  return points;
}

// The screen angles of the transitions at a state, ignoring its own loops: a loop has no
// direction to speak of, since its two ends are the same point.
function incidentEdgeAngles(node: any): number[] {
  const nodePos = node.position();
  return node
    .connectedEdges()
    .filter((e: any) => e.source().id() !== e.target().id())
    .map((e: any) => {
      const other = e.source().id() === node.id() ? e.target() : e.source();
      const p = other.position();
      return Math.atan2(p.y - nodePos.y, p.x - nodePos.x);
    });
}

// Utility: put the initial-state marker beside each initial state, creating it once.
function repositionStartNodes(cy: any) {
  const labelAnchors = edgeLabelAnchors(cy);

  cy.nodes()
    .filter((n: any) => n.data('initial'))
    .forEach((node: any, idx: number) => {
      const obstacles = cy
        .nodes()
        .filter((n: any) => n.id() !== node.id() && !n.hasClass('start'))
        .map((n: any) => n.position())
        .concat(labelAnchors)
        .concat(selfLoopObstacles(node));

      const angle = bestStartMarkerDirection(node.position(), obstacles, incidentEdgeAngles(node));
      // A final state carries the wider double border, and the marker has to clear its
      // outer circle rather than stopping at the nominal radius, which put the arrow's
      // point in the gap between the two circles.
      const pos = startMarkerPosition(
        node.position(),
        angle,
        NODE_DIAMETER,
        node.hasClass('final') ? FINAL_STATE_BORDER_WIDTH : STATE_BORDER_WIDTH,
      );
      const startNodeId = `__start${idx}`;
      let startNode = cy.getElementById(startNodeId);

      if (!startNode || startNode.empty()) {
        cy.add({
          group: 'nodes',
          // An explicit empty label: the node style maps `label` from data, and a node
          // without the field makes cytoscape warn about a mapping it cannot resolve.
          // This marker is the initial-state triangle and never shows text.
          data: { id: startNodeId, label: '' },
          position: pos,
          classes: 'start',
        });
        startNode = cy.getElementById(startNodeId);
      } else {
        startNode.position(pos);
      }
      // Turn the triangle to point back at its state, which only matters when the
      // marker has had to leave the state's left side.
      startNode.style({ 'shape-polygon-points': startMarkerPolygon(angle) });
    });
}

/* ─────────────────────────────── The hook ──────────────────────────────── */

export type UseJffCytoscapeOptions = {
  src: string;
  title?: string;
  epsSymbol?: string;
  /**
   * What the viewer opens at.
   *
   * `fit` scales the machine to the space available, which is right in a dialog where the
   * space is small and arbitrary. `actual` opens at 100%, so the drawing appears at the size
   * its author gave it, the way JFLAP shows it. The standalone window uses `actual`: it has
   * the whole screen, and a reader comparing what they see against JFLAP should be looking at
   * the same thing.
   */
  initialZoom?: 'fit' | 'actual';
  darkMode?: boolean;
  honorPositionsDefault?: boolean;
  /**
   * Remember the zoom, the pan and where the states were put, under this key.
   *
   * Set only by the standalone window, which passes the tab's own key. A viewer in a dialog
   * passes nothing and stays what it was: a look at a file, forgotten when it closes.
   */
  viewStateKey?: string | null;
};

/**
 * Owns the JFLAP viewer's cytoscape engine: fetching + parsing the .jff, initializing
 * the graph, laying it out (ELK / preset), wiring interaction, and the zoom/fit/export
 * actions. Extracted from JffViewerDialog so that component is just the toolbar + canvas
 * chrome. Returns the container ref to mount the graph into, the load `error` and parsed
 * machine `type`, the `honorPositions` toggle (a layout input), and the action handlers.
 */
/**
 * Wait for the next paint.
 *
 * Guarded, because a test environment without `requestAnimationFrame` would otherwise hang
 * here forever, and this is on the path that makes the graph visible at all.
 */
function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Where every state sits, and which layout produced it. */
type ArrangementSnapshot = {
  positions: Record<string, { x: number; y: number }>;
  honorPositions: boolean;
};

/**
 * The pan that keeps whatever was in the middle of the viewport in the middle of it.
 *
 * Resizing changes how much canvas there is, not what the reader is looking at. Recentring the
 * whole machine instead moves them somewhere they never asked to be: somebody examining one
 * corner of a large automaton drags the window, or splits the pane, and finds themselves back
 * at the middle of a machine they had deliberately scrolled away from.
 *
 * Cytoscape's pan is in rendered pixels and its zoom scales model units, so the model point at
 * the centre is `(size / 2 - pan) / zoom`. Putting the same point back at the centre of the
 * new size is that solved the other way round. Zoom is untouched.
 */
function panKeepingCentre(
  before: { width: number; height: number },
  after: { width: number; height: number },
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } | null {
  if (!(zoom > 0) || !isFinitePoint(pan)) return null;
  if (![before.width, before.height, after.width, after.height].every((n) => Number.isFinite(n))) {
    return null;
  }
  const centre = {
    x: (before.width / 2 - pan.x) / zoom,
    y: (before.height / 2 - pan.y) / zoom,
  };
  return { x: after.width / 2 - centre.x * zoom, y: after.height / 2 - centre.y * zoom };
}

/** A point cytoscape will accept: both halves present and real numbers. */
function isFinitePoint(value: any): value is { x: number; y: number } {
  return !!value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

/** Read the current arrangement out of the graph. */
function readArrangement(cy: any, honorPositions: boolean): ArrangementSnapshot | null {
  try {
    const positions: Record<string, { x: number; y: number }> = {};
    cy.nodes().forEach((node: any) => {
      // Notes and start markers are placed relative to what they annotate, so restoring them
      // directly would fight the code that keeps them attached.
      if (node.hasClass?.('note') || node.hasClass?.('start')) return;
      const p = node.position();
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y))
        positions[node.id()] = { x: p.x, y: p.y };
    });
    return { positions, honorPositions };
  } catch {
    return null;
  }
}

/** Put a remembered arrangement back. */
function applyArrangement(cy: any, snapshot: ArrangementSnapshot): void {
  try {
    for (const [id, position] of Object.entries(snapshot.positions)) {
      const node = cy.getElementById(id);
      if (node && !node.empty?.()) node.position(position);
    }
  } catch {
    // A graph mid-teardown. Nothing to restore onto.
  }
}

/**
 * Show or hide the notes a student wrote on the canvas.
 *
 * A style change rather than a rebuild: the notes are ordinary nodes carrying the `note`
 * class, so `display: none` takes them out of the drawing and out of the layout without
 * touching the machine itself. They only exist at all in the "As drawn" layout, since an
 * auto-arranged graph has moved every state and a note left where its author put it would
 * end up annotating whatever happened to land there.
 */
function applyNoteVisibility(cy: any, visible: boolean): void {
  try {
    cy.$('node.note').style('display', visible ? 'element' : 'none');
  } catch {
    // A graph mid-teardown. Nothing to show or hide, and nothing worth reporting.
  }
}

export function useJffCytoscape({
  src,
  title,
  epsSymbol = DEFAULT_EPS,
  initialZoom = 'fit',
  darkMode = false,
  honorPositionsDefault = false,
  viewStateKey = null,
}: UseJffCytoscapeOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<any | null>(null);

  const [error, setError] = useState<string | null>(null);
  /**
   * What was remembered about this file, read once.
   *
   * Through `useState` rather than `useRef` because `useRef` has no lazy initializer: its
   * argument is evaluated on every render, and this one parses a machine's worth of positions
   * out of storage. Zoom re-renders on every tick of the wheel.
   */
  const [savedView] = useState<ViewerViewState | null>(() => readViewState(viewStateKey));
  /**
   * Seeded from the saved view so the first load builds the layout the reader left, rather
   * than building the other one and then rebuilding when it is corrected. This is in `load`'s
   * dependencies, so a correction after mount costs a whole second load.
   *
   * Reading storage during render is safe here only because of who passes a key. A dialog
   * passes none, and mounts after a click in any case. The standalone window passes one, and
   * hides the layout control behind the menu, so no server-rendered markup depends on this
   * value and there is nothing for hydration to disagree about. A new caller that renders the
   * layout control on the server would have to think about that again.
   */
  const [honorPositions, setHonorPositions] = useState(
    savedView?.honorPositions ?? honorPositionsDefault,
  );
  const [type, setType] = useState<MachineType>('unknown');
  // Kept so the viewer can render a text description of the machine; the canvas alone
  // is not a usable representation for a screen reader.
  const [parsed, setParsed] = useState<Parsed | null>(null);
  // The live zoom level, mirrored into state so a slider can show it. Cytoscape owns the
  // real value; this follows it, including when the wheel or the Fit button changes it.
  const [zoom, setZoomState] = useState(1);
  // Notes the student wrote on the canvas. On by default: they are the author's own words and
  // part of the answer, not decoration. Turned off when they crowd a busy machine.
  const [showNotes, setShowNotes] = useState(true);
  // Off by default: a machine arrives with the positions its author chose, and quietly moving
  // every state the first time one is nudged would be a change nobody asked for.
  const [snapToGrid, setSnapToGrid] = useState(false);
  // The state a reader has clicked, if any. Held as an id rather than a described object so it
  // survives a reload of the same file and cannot go stale against a re-parsed machine.
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  /**
   * Whether the first layout has finished and the graph is worth showing.
   *
   * Cytoscape paints as soon as it is constructed, at whatever scale the file's coordinates
   * happen to imply, and only then does the fit run and the zoom settle. The reader saw the
   * machine arrive at the wrong size and jump. Nothing is drawn until this is true.
   */
  const [settled, setSettled] = useState(false);
  // The edge a reader has clicked, as its two endpoints rather than an element id: the id is
  // assigned by the bundler and would not survive a re-parse, while the pair is the machine's
  // own identity for it.
  const [selectedEdge, setSelectedEdge] = useState<{ from: string; to: string } | null>(null);
  // Read by the load path, which runs outside React's render and would otherwise capture the
  // value from whenever the effect that started it was created.
  const showNotesRef = useRef(showNotes);
  showNotesRef.current = showNotes;
  const snapToGridRef = useRef(snapToGrid);
  snapToGridRef.current = snapToGrid;
  const initialZoomRef = useRef(initialZoom);
  initialZoomRef.current = initialZoom;
  const honorPositionsRef = useRef(honorPositions);
  honorPositionsRef.current = honorPositions;

  /**
   * Undo history for the arrangement.
   *
   * The viewer is read only about the file: nothing here changes what the student submitted.
   * What a reader CAN change is how it is laid out, by dragging a state or switching between
   * the drawn and the auto-arranged layout, and that is what these remember. Zoom and pan are
   * not in it: they move the camera, not the machine, and an undo that rewound the viewport
   * would fight the scroll wheel.
   *
   * Each entry is a whole snapshot rather than a diff. A machine has tens of states, not
   * thousands, so copying every position is cheaper than the bookkeeping a diff would need.
   */
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);
  const undoStack = useRef<ArrangementSnapshot[]>([]);
  const redoStack = useRef<ArrangementSnapshot[]>([]);
  /**
   * An arrangement waiting for the graph to be rebuilt before it can be applied.
   *
   * Stepping across a layout switch changes `honorPositions`, which `load` depends on, so the
   * graph is torn down and built again. Applying the snapshot before that happened put the
   * positions onto a graph that was about to be discarded, and the step appeared to restore
   * the layout while silently losing every state the reader had moved under it. The camera
   * rides along for the same reason: the rebuild refits, and an undo should not move the view.
   */
  /** The file the graph currently holds, so a rebuild of the same one is recognised. */
  const loadedSrc = useRef<string | null>(null);
  const pendingArrangement = useRef<{
    snapshot: ArrangementSnapshot;
    zoom: number;
    pan: { x: number; y: number };
  } | null>(null);

  // Customization variables
  const FIT_PADDING = 80;
  /**
   * The grid's spacing, in model units.
   *
   * The same number the CSS background uses for its lines, which is what lets the two agree:
   * the background is kept in step with the graph's zoom and pan below, so a state snapped to
   * this lattice lands on a line the reader can actually see.
   */
  const GRID_STEP = 24;
  // Ceiling on the zoom the initial fit may choose. Without one, fitting fills the canvas
  // whatever is in it, and a two-state machine arrived at roughly 4x. 1:1 turned out to
  // read as too distant on a large screen, so allow a moderate enlargement and no more.
  const MAX_INITIAL_ZOOM = 1.5;
  // How far the self-loop arcs out from the state. The label geometry that goes with it
  // lives in lib/jflap-layout, which is where LOOP_REACH records what this produces.
  const LOOP_STEP_SIZE = 48;

  // Expose onResize for Fit button
  const onResizeRef = useRef<(() => void) | null>(null);

  /* ── remembering the view across a refresh ──────────────────────────── */

  const viewStateKeyRef = useRef(viewStateKey);
  viewStateKeyRef.current = viewStateKey;

  /** Write down where the reader is looking and where they have put the states. */
  const rememberView = useCallback(() => {
    if (!viewStateKeyRef.current) return;
    const cy = cyRef.current;
    if (!cy) return;
    try {
      const arrangement = readArrangement(cy, honorPositionsRef.current);
      const pan = cy.pan();
      const zoom = cy.zoom();
      if (!arrangement || !isFinitePoint(pan) || !Number.isFinite(zoom) || zoom <= 0) return;
      writeViewState(viewStateKeyRef.current, {
        v: 1,
        zoom,
        pan: { x: pan.x, y: pan.y },
        positions: arrangement.positions,
        honorPositions: arrangement.honorPositions,
      });
    } catch {
      // A graph mid-teardown, or storage refusing. Neither is worth interrupting a reader.
    }
    // Everything it touches is a ref, so it never needs rebuilding.
  }, []);

  /**
   * Put a remembered view back, and say whether it was used.
   *
   * False when there is nothing saved, or when what is saved names states this machine does
   * not have. The caller then opens the file the ordinary way.
   */
  /**
   * The remembered view belongs to the first load and nothing after it.
   *
   * Switching between the drawn and the auto-arranged layout rebuilds the graph, and without
   * this the restore ran again at the end of that rebuild and put the old positions straight
   * back over the layout engine's. Choosing Auto-arranged appeared to do nothing at all.
   */
  const hasRestored = useRef(false);

  /**
   * Bumped to rebuild the graph when nothing `load` depends on has changed.
   *
   * Reset is the only user of it: resetting a machine that is already on its own layout has
   * to re-read the file anyway, because the states have been dragged since.
   */
  const [reloadNonce, setReloadNonce] = useState(0);

  const restoreSavedView = useCallback(
    (cy: any): boolean => {
      const saved = savedView;
      if (!saved || hasRestored.current) return false;
      hasRestored.current = true;
      try {
        const ids = cy.nodes().map((node: any) => node.id());
        if (!viewStateFits(saved, ids)) return false;
        applyArrangement(cy, { positions: saved.positions, honorPositions: saved.honorPositions });
        cy.zoom(saved.zoom);
        cy.pan(saved.pan);
        return true;
      } catch {
        // An engine that does not offer these, which is every one of them in a test that has
        // not been told about this. Opening at the fit is the right answer either way.
        return false;
      }
    },
    // Read once at mount and never replaced, so this is built once.
    [savedView],
  );

  const load = useMemo(
    () => async () => {
      setError(null);
      // Before anything else, and before any await. A second load onto a viewer that is
      // already showing something (React re-running effects in development, or the source
      // changing) would otherwise start with the graph visible, and the new machine would be
      // painted un-fitted for the moment before its own layout settles. That is the flash.
      setSettled(false);
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
        const text = await res.text();

        const parsed = parseJflap(text);
        setType(parsed.type);
        setParsed(parsed);
        setSelectedStateId(null);
        setSelectedEdge(null);
        // A different file is a different machine. Keeping the old history would let undo
        // apply one machine's positions to another's states.
        //
        // Only for a different file, though. Switching between the drawn and the auto-arranged
        // layout rebuilds this same machine, and clearing here made the switch itself
        // impossible to undo: the step that recorded it was thrown away by the rebuild it
        // caused. Reset clears the history itself, since there it is the point.
        if (loadedSrc.current !== src) {
          loadedSrc.current = src;
          undoStack.current = [];
          redoStack.current = [];
          setUndoDepth(0);
          setRedoDepth(0);
        }
        const elements = toElements(parsed, epsSymbol, honorPositions);

        if (!containerRef.current) {
          return;
        }

        const cytoscape = await ensureCytoscapeReady();

        if (cyRef.current) {
          cyRef.current.destroy();
          cyRef.current = null;
        }

        // Canvas labels need a concrete font-family string, and next/font
        // registers Geist under a hashed name, so read it off the body.
        const uiFontFamily =
          (typeof window !== 'undefined' && getComputedStyle(document.body).fontFamily) ||
          'ui-sans-serif, system-ui';

        // Edges and their labels sit on the canvas, not inside a state, so unlike the
        // state fill they cannot be JFLAP's flat black: that is invisible on a dark
        // background. They follow the theme; everything on the state stays JFLAP's.
        const STROKE = darkMode ? '#e2e8f0' : '#000000';
        const TEXT_COLOR = STROKE;

        // A note is the student's own words rather than part of the machine, so it is drawn as
        // a piece of paper laid on the canvas: a pale panel in light, a raised one in dark.
        // Hex literals for the same reason as everything else here, see the note at the top.
        const NOTE_FILL = darkMode ? '#1e293b' : '#fefce8';
        const NOTE_BORDER = darkMode ? '#475569' : '#d6d3a8';
        const NOTE_TEXT = darkMode ? '#e2e8f0' : '#1f2937';

        // The canvas behind the drawing, used to fill the start marker. Unfilled, the grid
        // and any edge behind it showed straight through the triangle, which made it read as
        // an outline rather than a piece of the machine. Filling it with the canvas colour
        // keeps the shape JFLAP draws while making it opaque.
        const CANVAS_FILL = darkMode ? '#141d33' : '#ffffff';

        const cy = cytoscape({
          container: containerRef.current!,
          elements,
          minZoom: 0.2,
          maxZoom: 6,
          style: [
            /* nodes */
            {
              selector: 'node',
              style: {
                // Above a note; see the note style below for why.
                'z-index': 1,
                'background-color': NODE_FILL,
                'border-color': STATE_STROKE,
                'border-width': STATE_BORDER_WIDTH,
                label: 'data(label)',
                'font-family': uiFontFamily,
                'font-size': 16,
                color: STATE_TEXT,
                'text-valign': 'center',
                'text-halign': 'center',
                width: 58,
                height: 58,
                shape: 'ellipse',
              },
            },
            // JFLAP marks a final state with a second, inner circle. A double border is
            // the same picture without a second element per state.
            {
              selector: 'node.final',
              style: { 'border-width': FINAL_STATE_BORDER_WIDTH, 'border-style': 'double' },
            },
            // The initial-state marker, drawn the way JFLAP draws it: an unfilled
            // triangle on its side with its point against the state. It follows the theme
            // rather than JFLAP's flat black, for the same reason the edges do: it sits on
            // the canvas, not inside a state, so black disappears on a dark background.
            {
              selector: 'node.start',
              style: {
                shape: 'polygon',
                'shape-polygon-points': startMarkerPolygon(),
                width: START_MARKER_SIZE,
                height: START_MARKER_SIZE,
                'background-color': CANVAS_FILL,
                'background-opacity': 1,
                'border-color': STROKE,
                'border-width': 2,
                events: 'no',
              },
            },

            /* edges (default) */
            {
              selector: 'edge',
              style: {
                'z-index': 1,
                'curve-style': 'bezier',
                'line-color': STROKE,
                width: EDGE_WIDTH,
                'target-arrow-color': STROKE,
                'source-arrow-color': STROKE,
                'source-arrow-shape': 'none',
                'target-arrow-shape': 'triangle',
                'arrow-scale': 1.1,
                label: 'data(label)',
                'font-family': uiFontFamily,
                'font-size': 16,
                'min-zoomed-font-size': 7,
                color: TEXT_COLOR,
                'text-wrap': 'wrap',
                'text-max-width': 140,
                // Lay each label along its own edge, as JFLAP does. This was previously
                // 'none', on the grounds that autorotate rendered a right-to-left edge's
                // label upside down; on the cytoscape this now ships, it does not, and
                // keeps every label the right way up whichever way its edge runs.
                'text-rotation': 'autorotate',
              },
            },
            /* self-loops on TOP with arrow at start */
            {
              selector: 'edge[isLoop = 1]',
              style: {
                // `bezier`, not `loop`. Cytoscape has no `loop` curve-style: it recognises
                // a self-loop on its own and shapes it from `loop-direction`, `loop-sweep`
                // and `control-point-step-size` below. Naming one made cytoscape reject
                // the property and log an error per loop on every single render.
                'curve-style': 'bezier',
                'loop-direction': '0deg',
                'loop-sweep': '50deg',
                'control-point-step-size': 48,
                'source-arrow-shape': 'triangle',
                'target-arrow-shape': 'none',
                'arrow-scale': 0.95,
                'line-cap': 'round',
                'text-rotation': 'none',
              },
            },

            /*
             * A note the student wrote on the canvas.
             *
             * Deliberately unlike a state: a soft rectangle rather than JFLAP's yellow circle,
             * so nobody reads it as part of the machine. Sized from the text by `noteBox`,
             * which is also what positioned it, so the box and the wrap agree.
             */
            {
              selector: 'node.note',
              style: {
                shape: 'round-rectangle',
                'background-color': NOTE_FILL,
                'background-opacity': 0.95,
                'border-color': NOTE_BORDER,
                'border-width': 1,
                width: 'data(width)',
                height: 'data(height)',
                label: 'data(label)',
                color: NOTE_TEXT,
                'font-size': NOTE_FONT_SIZE,
                'font-family': uiFontFamily,
                'text-wrap': 'wrap',
                'text-max-width': `${NOTE_MAX_WIDTH}px`,
                'text-valign': 'center',
                'text-halign': 'center',
                'text-justification': 'left',
                /**
                 * Behind the machine.
                 *
                 * A note sits wherever the student dropped it and nothing moves aside for it,
                 * so it can overlap a state. When it does, the answer has to win: a note is
                 * the student's aside, and losing sight of a state behind an opaque panel
                 * would be a worse reading of the file than a note partly covered. JFLAP draws
                 * its notes on top, because there they are live Swing components the student
                 * is editing; here nobody is editing anything.
                 */
                'z-index': 0,
                // Not part of the machine, so a tap must not pick it up and fade everything
                // else out around it.
                events: 'no',
              },
            },

            /* interaction: JFLAP's own selection blue (gui/Globals.FROM_COLOR) */
            {
              selector: '.highlighted',
              style: {
                'line-color': HIGHLIGHT_COLOR,
                'target-arrow-color': HIGHLIGHT_COLOR,
                'source-arrow-color': HIGHLIGHT_COLOR,
                'border-color': HIGHLIGHT_COLOR,
                // The fill stays JFLAP's yellow so a highlighted state still reads as a
                // state; only its outline and its edges change.
                'background-color': NODE_FILL,
              },
            },
            { selector: '.faded', style: { opacity: 0.25 } },
          ],
          layout: { name: 'preset' },
        });

        // Function to lay each transition label along its edge and lift it clear of the line.
        async function updateEdgeLabelMargins() {
          cy.edges().forEach((edge: any) => {
            // Self-loops are handled by `selfLoopGeometry`, which lifts the label past the
            // loop and leaves it horizontal, as JFLAP does. Source and target coincide, so
            // there is no edge direction here to work from anyway.
            if (edge.data('isLoop') === 1) return;
            const { x, y } = edgeLabelOffset(
              edge.source().position(),
              edge.target().position(),
              edge.midpoint(),
            );
            // The angle comes from `text-rotation: autorotate` in the stylesheet. These
            // margins are in screen space, not the label's own rotated frame, so the
            // standoff stays perpendicular to the edge whatever angle the label is at.
            edge.style({ 'text-margin-x': x, 'text-margin-y': y });
          });
        }

        // Function to aim each self-loop and put its label beyond it. Runs after
        // `updateEdgeLabelMargins`, so where every other transition label sits is already
        // settled and a loop can be steered clear of them.
        async function selfLoopGeometry() {
          const labelAnchors = edgeLabelAnchors(cy);

          cy.edges('[isLoop = 1]').forEach((e: any) => {
            const node = e.source();
            const nodePos = node.position();
            const obstacles = cy
              .nodes()
              .filter((n: any) => n.id() !== node.id() && !n.hasClass('start'))
              .map((n: any) => n.position())
              .concat(labelAnchors);

            const direction = bestLoopDirection(nodePos, obstacles, incidentEdgeAngles(node));
            // Remembered so the initial-state marker, which is placed after this, can be
            // steered clear of the loop.
            e.data('loopDirection', direction);
            const lines = String(e.data('label') ?? '').split('\n').length;
            const offset = loopLabelOffset(direction, lines);

            e.style({
              // See the stylesheet above: cytoscape has no `loop` curve-style.
              'curve-style': 'bezier',
              'loop-direction': `${direction}deg`,
              'loop-sweep': '50deg',
              'control-point-step-size': LOOP_STEP_SIZE,
              'source-arrow-shape': 'triangle',
              'target-arrow-shape': 'none',
              'arrow-scale': 0.95,
              'line-cap': 'round',
              'text-rotation': 'none',
              'text-margin-x': offset.x,
              'text-margin-y': offset.y,
            });
          });
        }

        // Function to fit and resize frame
        async function fitAndResize() {
          if (!cyRef.current) return;

          const cy = cyRef.current;
          try {
            cy.resize();
            const elkAspectRatio =
              !containerRef.current?.clientWidth || !containerRef.current?.clientHeight
                ? '1.6f'
                : `${containerRef.current.clientWidth / containerRef.current.clientHeight}f`;
            let layoutOptions;
            if (!honorPositions) {
              /*
               * Give the layout room for the LABELS, not just the states.
               *
               * ELK lays out nodes and edges; it knows nothing about the text cytoscape
               * later draws on an edge. With a flat 50px node spacing that was fine for an
               * FA whose labels are one character, and hopeless for a PDA or TM, where
               * `0 → 0, R` or eight stacked stack-operations end up longer than the edge
               * they sit on. Adjacent labels then landed on top of each other.
               *
               * So measure the widest and tallest label actually present and ask for edges
               * long enough to hold one. A machine of single-character labels keeps a
               * compact layout; a wordy one spreads out only as much as it has to.
               */
              let widestLabel = 0;
              let tallestLabel = 1;
              cy.edges().forEach((e: any) => {
                const lines = String(e.data('label') ?? '').split('\n');
                tallestLabel = Math.max(tallestLabel, lines.length);
                for (const line of lines) {
                  widestLabel = Math.max(widestLabel, line.length);
                }
              });
              // ~8px per character at the 16px edge font, capped so one pathological label
              // can't push the whole machine apart.
              const labelWidth = Math.min(widestLabel * 8, 220);
              const labelHeight = Math.min(tallestLabel * LABEL_LINE_HEIGHT, 220);

              layoutOptions = {
                name: 'elk',
                nodeDimensionsIncludeLabels: true,
                elk: {
                  // `stress` over `force`: it honours a desired edge length, which is the
                  // one lever that actually buys space for a label, and it produces a
                  // stable, symmetric result for the small cyclic graphs automata are.
                  algorithm: 'stress',
                  'elk.aspectRatio': elkAspectRatio,
                  'elk.stress.desiredEdgeLength': String(160 + labelWidth),
                  'elk.spacing.nodeNode': String(60 + labelHeight),
                  // Deterministic: the same machine should lay out the same way every time
                  // it is opened, so a student and an instructor discuss the same picture.
                  'elk.randomSeed': '1',
                },
              };
            } else {
              layoutOptions = {
                name: 'preset',
                positions: undefined,
              };
            }

            // Load the new layout properly based on the layout option
            if (layoutOptions.name === 'preset') {
              // honorPositions
              cy.layout(layoutOptions).run();
            } else {
              await new Promise((resolve) => {
                // !honorPositions
                const layout = cy.layout(layoutOptions);
                layout.run();
                layout.on('layoutstop', resolve);
              });
            }

            await updateEdgeLabelMargins();
            await selfLoopGeometry();
            repositionStartNodes(cy);

            if (cy.nodes().length === 0) return;

            // Fit to the real extent of everything, LABELS INCLUDED. The old maths took the
            // min/max of node CENTRES, so each node's own radius and every edge label lay
            // outside the box it fitted to, and a tall self-loop label or a wide transition
            // label was reliably cut off at the edge of the canvas. `fit` measures the
            // rendered bounding box, which is what the reader actually has to see.
            cy.fit(cy.elements(), FIT_PADDING);

            // Then back off if that magnified a small machine. Fitting alone fills the
            // canvas whatever is in it, so a two-state automaton arrived at 4x with states
            // the size of a fist and no context around them. Above 1:1 there is nothing
            // more to see, only bigger circles, so cap it and re-centre.
            if (cy.zoom() > MAX_INITIAL_ZOOM) {
              cy.zoom(MAX_INITIAL_ZOOM);
              cy.center(cy.elements());
            }
          } catch {}
        }

        cyRef.current = cy;

        // Follow cytoscape rather than tracking zoom in parallel: the wheel, a pinch, Fit and
        // the buttons all change it, and a second source of truth would drift from whichever
        // of those the user reached for last.
        setZoomState(cy.zoom());
        cy.on('zoom', () => setZoomState(cy.zoom()));

        // make sure zooming/panning are enabled
        cy.userZoomingEnabled(true);
        cy.panningEnabled(true);
        cy.userPanningEnabled(true);

        // The notes are elements like any other, so hiding them is a style change rather than
        // a rebuild. Applied here as well as in the effect below because the elements only
        // exist from this point, and an effect that ran before them would do nothing.
        applyNoteVisibility(cy, showNotesRef.current);

        // Expose fitAndResize for Fit button and initial layout
        onResizeRef.current = () => void fitAndResize();
        setTimeout(() => {
          void (async () => {
            try {
              // Fit first either way: it sizes the canvas and settles the layout, and the
              // centring it does is what keeps the machine in view at 100% rather than off in
              // a corner. Only then is the scale set back to 1:1, if that was asked for.
              await fitAndResize();
              const current = cyRef.current;
              if (!current) return;
              // An undo that crossed a layout switch, waiting for this rebuild. It wins over
              // everything else here: it is the reader asking for a particular arrangement
              // back, and for the view not to move while they get it.
              const pending = pendingArrangement.current;
              if (pending) {
                pendingArrangement.current = null;
                applyArrangement(current, pending.snapshot);
                current.zoom(pending.zoom);
                current.pan(pending.pan);
                return;
              }
              // A remembered view wins over both, because it is where the reader was.
              if (restoreSavedView(current)) return;
              if (initialZoomRef.current !== 'actual') return;
              current.zoom(1);
              current.center(current.nodes());
            } catch (err) {
              // Reported rather than swallowed: the graph still appears, thanks to the
              // `finally` below, so nothing here is worth failing a load over, but a scale
              // step that has started throwing is a bug somebody should see.
              console.error('[viewer] could not set the initial scale:', err);
            } finally {
              // One frame first. Revealing in the same tick as the last change uncovers the
              // canvas while cytoscape may still be redrawing it, which is the tail of the
              // flash rather than its cause.
              await nextFrame();
              // In a `finally` so a layout that throws still reveals the graph. A machine
              // drawn wrongly is recoverable; one that never appears is not.
              setSettled(true);
              // Write the opening view down now, so a reader who changes nothing and refreshes
              // still comes back to the same picture. Nothing above this can lose the saved
              // view: it was read into `savedView` before the first render.
              rememberView();
            }
          })();
        }, 0);

        // Everything that changes the view, in one place. `viewport` covers the zoom and the
        // pan, whichever of the wheel, the slider, Fit or a drag of the background caused
        // them; `position` covers a state being moved, including by undo and redo. Debounced,
        // because both fire continuously while a reader is dragging. Written as it happens
        // rather than on the way out, so a browser that is closed or killed still leaves the
        // view it had.
        const rememberViewSoon = debounce(rememberView, 400);
        cy.on('viewport position', rememberViewSoon);

        /**
         * Keep the canvas in step with its container without touching the zoom.
         *
         * This used to refit on a window resize, which threw away whatever magnification the
         * reader had set: they would zoom in on one corner of a large machine, drag the window
         * wider, and find themselves looking at the whole thing again. It re-centres instead,
         * so the same detail is still on screen at the same size.
         *
         * A `ResizeObserver` on the container rather than a listener on the window, because
         * the container is what actually matters and it can change without the window doing
         * anything: the standalone viewer's panes are half-width, and a dialog can be resized
         * by things other than the window. A window resize reaches this too, since it changes
         * the container.
         */
        const resizeKeepingZoom = debounce(() => {
          const current = cyRef.current;
          if (!current) return;
          try {
            const before = { width: current.width(), height: current.height() };
            const zoom = current.zoom();
            const pan = { ...current.pan() };
            current.resize();
            const next = panKeepingCentre(
              before,
              { width: current.width(), height: current.height() },
              zoom,
              pan,
            );
            if (next) current.pan(next);
          } catch {
            // A graph mid-teardown. Nothing to resize.
          }
        }, 160);
        if (typeof ResizeObserver === 'function' && containerRef.current) {
          const observer = new ResizeObserver(resizeKeepingZoom);
          observer.observe(containerRef.current);
          (cy as any).__resizeObserver = observer;
        }

        // Adjust the layout of the transitions
        await updateEdgeLabelMargins();

        // keep zooming/panning enabled after layout
        cy.userZoomingEnabled(true);
        cy.panningEnabled(true);
        cy.userPanningEnabled(true);

        // highlight on click
        cy.on('tap', (evt: any) => {
          if (evt.target === cy) {
            cy.elements().removeClass('faded highlighted');
            // A click on empty canvas means "never mind", so the properties panel goes too.
            setSelectedStateId(null);
            setSelectedEdge(null);
            return;
          }
          const ele = evt.target;
          // Scenery, not machine: a note is the author's words laid on the canvas, and the
          // start marker is a decoration hanging off the initial state. Clicking either does
          // nothing at all rather than dimming the machine around it. (`events: 'no'` should
          // already stop a note being a tap target; this is the belt to that brace, since a
          // note has no neighbourhood and would otherwise fade everything.)
          if (ele.hasClass?.('note') || ele.hasClass?.('start')) return;
          // One panel at a time: a state and an edge cannot both be what was just clicked.
          const isNode = ele.isNode?.() ?? false;
          setSelectedStateId(isNode ? (ele.id?.() ?? null) : null);
          setSelectedEdge(
            isNode ? null : { from: ele.data?.('source') ?? '', to: ele.data?.('target') ?? '' },
          );
          const neighborhood = ele.closedNeighborhood
            ? ele.closedNeighborhood()
            : ele.neighborhood();
          cy.elements().addClass('faded');
          neighborhood.addClass('highlighted').removeClass('faded');
        });

        /**
         * Keep the painted grid in step with the graph.
         *
         * The lines are a CSS background on the container, so without this they stay put while
         * the machine pans and zooms underneath them: decoration rather than a grid. Written
         * straight to the element rather than through state, because it changes on every frame
         * of a pan and re-rendering React that often would be absurd. The component sets only
         * `background-image`, so it never clobbers these two.
         */
        const syncGridToGraph = () => {
          try {
            const el = containerRef.current;
            if (!el) return;
            const scale = cy.zoom();
            const offset = cy.pan();
            if (!Number.isFinite(scale) || !Number.isFinite(offset?.x)) return;
            el.style.backgroundSize = `${GRID_STEP * scale}px ${GRID_STEP * scale}px`;
            el.style.backgroundPosition = `${offset.x}px ${offset.y}px`;
          } catch {
            // The grid is decoration. It is drawn during the same load that draws the machine,
            // and a viewer that refused to show a machine because it could not place a
            // background line would be trading the whole feature for the trim on it.
          }
        };
        cy.on('zoom pan resize', syncGridToGraph);
        syncGridToGraph();

        // Snap on release rather than during the drag: the state follows the pointer exactly
        // while it is held, then settles onto the lattice, which reads as landing rather than
        // as the drag fighting back.
        cy.on('dragfree', 'node', (evt: any) => {
          if (!snapToGridRef.current) return;
          const node = evt.target;
          if (!node?.position || node.hasClass?.('note') || node.hasClass?.('start')) return;
          const at = node.position();
          if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return;
          node.position({
            x: Math.round(at.x / GRID_STEP) * GRID_STEP,
            y: Math.round(at.y / GRID_STEP) * GRID_STEP,
          });
        });

        // A drag is one undoable step, so the snapshot is taken when the state is picked up
        // rather than on every pixel of movement. `grab` fires once, at the start.
        cy.on('grab', 'node', () => {
          const before = readArrangement(cy, honorPositionsRef.current);
          if (!before) return;
          undoStack.current.push(before);
          // A new action makes the redo branch unreachable, as in any editor.
          redoStack.current = [];
          setUndoDepth(undoStack.current.length);
          setRedoDepth(0);
        });

        // Keep the label and loop geometry, and the initial-state marker, following a
        // state the reader has dragged. Moving the marker itself fires this too, so skip
        // it: it has nothing hanging off it, and reacting would only recurse.
        cy.on('position', async (evt: any) => {
          const target = evt.target;
          if (!target?.isNode?.() || target.hasClass('start') || target.hasClass('note')) return;

          await updateEdgeLabelMargins();
          await selfLoopGeometry();
          repositionStartNodes(cy);
        });
      } catch (e: any) {
        console.error(e);
        setError(e?.message || 'Failed to render .jff');
      }
    },
    // The last two never change identity, so they cost nothing here.
    [src, epsSymbol, darkMode, honorPositions, rememberView, restoreSavedView],
  );

  /**
   * Write the view down on the way out.
   *
   * The writer is debounced, so a wheel or a drag in the last fraction of a second before a
   * refresh would otherwise not be saved: exactly the sequence somebody runs to check that
   * this works at all. Reads only refs, so the closure being from the first render is fine.
   */
  useEffect(() => {
    const flush = () => rememberView();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [rememberView]);

  // `reloadNonce` is here rather than in `load` because the cleanup below is what makes a
  // rebuild safe: it destroys the previous engine and takes its resize listener with it.
  useEffect(() => {
    if (typeof window !== 'undefined') void load();
    return () => {
      const cy = cyRef.current;
      if (cy) {
        (cy as any).__resizeObserver?.disconnect();
        cy.destroy();
        cyRef.current = null;
      }
    };
  }, [load, reloadNonce]);

  /* ── undo and redo ──────────────────────────────────────────────────── */

  /** Move one step between the two stacks, applying whatever is on the other side. */
  const step = (from: typeof undoStack, to: typeof redoStack) => {
    const cy = cyRef.current;
    const snapshot = from.current.pop();
    if (!cy || !snapshot) return;

    const current = readArrangement(cy, honorPositions);
    if (current) to.current.push(current);

    if (snapshot.honorPositions !== honorPositions) {
      // Switching the layout rebuilds the graph, so the positions cannot be put back on this
      // one: they are handed to the load that is about to run instead.
      try {
        pendingArrangement.current = { snapshot, zoom: cy.zoom(), pan: { ...cy.pan() } };
      } catch {
        pendingArrangement.current = { snapshot, zoom: 1, pan: { x: 0, y: 0 } };
      }
      setHonorPositions(snapshot.honorPositions);
    } else {
      applyArrangement(cy, snapshot);
    }

    setUndoDepth(undoStack.current.length);
    setRedoDepth(redoStack.current.length);
  };

  /* ── notes ──────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (cyRef.current) applyNoteVisibility(cyRef.current, showNotes);
  }, [showNotes, parsed, honorPositions]);

  /* ── zoom helpers (animated, keep center fixed) ─────────────────────── */
  const animatedZoomTo = (level: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    const min = typeof cy.minZoom === 'function' ? cy.minZoom() : 0.2;
    const max = typeof cy.maxZoom === 'function' ? cy.maxZoom() : 6;
    const next = Math.max(min, Math.min(max, level));
    // Use cy.center(cy.nodes()) to get the center position
    const center = cy.center(cy.nodes());
    cy.animate({ zoom: next, center }, { duration: 120, easing: 'ease-in-out' });
  };

  /** Zoom bounds, read from the instance so they cannot disagree with the config above. */
  const zoomRange = () => {
    const cy = cyRef.current;
    const min = cy && typeof cy.minZoom === 'function' ? cy.minZoom() : 0.2;
    const max = cy && typeof cy.maxZoom === 'function' ? cy.maxZoom() : 6;
    return { min, max };
  };

  /**
   * Set the zoom directly, without the easing the buttons use.
   *
   * A slider is dragged continuously, and animating each step would leave the graph chasing
   * the thumb instead of tracking it.
   */
  const setZoom = (level: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    const { min, max } = zoomRange();
    cy.zoom({ level: Math.max(min, Math.min(max, level)), renderedPosition: undefined });
    cy.center(cy.nodes());
  };

  const zoomIn = () => {
    const cy = cyRef.current;
    if (!cy) return;
    animatedZoomTo(cy.zoom() * 1.2);
  };

  const zoomOut = () => {
    const cy = cyRef.current;
    if (!cy) return;
    animatedZoomTo(cy.zoom() / 1.2);
  };

  const downloadSVG = async () => {
    if (!cyRef.current) return;
    const svgStr: string = cyRef.current.svg({ scale: 1, full: true });
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    await downloadDataUrl(`${(title ?? 'automaton').replace(/\s+/g, '_')}.svg`, url);
    URL.revokeObjectURL(url);
  };

  // Use the canvas's actual background (white in light mode) so exported/copied
  // images match the viewer instead of coming out transparent.
  const exportBackground = () => {
    const el = containerRef.current;
    if (el) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
    }
    return '#ffffff';
  };

  const downloadPNG = async () => {
    if (!cyRef.current) return;
    const dataUrl: string = cyRef.current.png({ scale: 2, full: true, bg: exportBackground() });
    await downloadDataUrl(`${(title ?? 'automaton').replace(/\s+/g, '_')}.png`, dataUrl);
  };

  /**
   * Copy the drawing as SVG, as text.
   *
   * Written to the clipboard as a string rather than as an `image/svg+xml` item, because that
   * is what the places people paste into actually accept: a text paste lands as editable
   * vector art in Illustrator or Inkscape and as markup in an editor, whereas an svg
   * clipboard item is ignored by most of them.
   */
  const copySVG = async () => {
    if (!cyRef.current) return;
    const svgStr: string = cyRef.current.svg({ scale: 1, full: true });
    try {
      await navigator.clipboard.writeText(svgStr);
    } catch {
      // No clipboard permission, or an insecure origin. Falling back to the download keeps
      // the action doing something rather than failing silently.
      await downloadSVG();
    }
  };

  /** Copy the machine as prose, the one export that can be quoted in a reply. */
  const copyDescription = async () => {
    if (!parsed) return;
    const text = machineDescriptionText(describeMachine(parsed, epsSymbol));
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Nothing to fall back to that would not be a surprise, so this stays quiet. The same
      // text is on screen behind "Show text representation" and can be selected by hand.
    }
  };

  /**
   * The machine as it currently sits, as a `.jff`.
   *
   * The point of it is the auto-arranged layout: the engine's placement is usually far more
   * readable than a hand-drawn one, and until now there was no way to keep it. Positions are
   * read from the live graph rather than from the parsed file, so what is saved is what is on
   * screen.
   *
   * The submitted file is never touched. This writes a new one, because the bytes a student
   * submitted are the record of what they did and several stored hashes are derived from them.
   */
  const downloadCurrent = async () => {
    const cy = cyRef.current;
    if (!cy || !parsed) return;

    const states = parsed.states.map((state) => {
      const node = cy.getElementById(state.id);
      // A state the graph does not have (it should not happen) keeps the position it came
      // with, rather than being moved to the origin.
      if (!node || typeof node.position !== 'function' || node.empty?.()) return state;
      const position = node.position();
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return state;
      // Both cytoscape and JFLAP put a state's coordinates at its centre, so this is a
      // straight copy. Notes are the ones that differ, and they are not moved here.
      return { ...state, xPos: position.x, yPos: position.y };
    });

    const xml = toJflapXml({ ...parsed, states });
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    await downloadDataUrl(`${(title ?? 'automaton').replace(/\s+/g, '_')}.jff`, url);
    URL.revokeObjectURL(url);
  };

  const copyPNG = async () => {
    if (!cyRef.current) return;
    try {
      const dataUrl: string = cyRef.current.png({ scale: 2, full: true, bg: exportBackground() });
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const ClipboardItemCtor: any =
        (globalThis as any).ClipboardItem || (window as any).ClipboardItem;
      if (ClipboardItemCtor && navigator.clipboard && (navigator.clipboard as any).write) {
        const item = new ClipboardItemCtor({ [blob.type]: blob });
        await (navigator.clipboard as any).write([item]);
      } else {
        throw new Error('ClipboardItem not supported');
      }
    } catch {
      await downloadPNG();
    }
  };

  return {
    containerRef,
    settled,
    error,
    type,
    parsed,
    honorPositions,
    toggleHonorPositions: () => {
      // Recorded before the switch, so undo returns both the layout and the positions the
      // reader had arranged under it.
      const before = cyRef.current ? readArrangement(cyRef.current, honorPositions) : null;
      if (before) {
        undoStack.current.push(before);
        redoStack.current = [];
        setUndoDepth(undoStack.current.length);
        setRedoDepth(0);
      }
      setHonorPositions((p) => !p);
    },
    /**
     * Put this machine back the way it opened.
     *
     * The states return to where the file has them, the layout returns to the one the viewer
     * opens on, and the remembered view and the undo history go. Only this machine: the other
     * tabs, the grid, the notes and snapping are all left alone.
     *
     * Nothing here touches the submitted file. It was never changed in the first place; what
     * is being discarded is the reader's own rearranging of the drawing.
     */
    resetMachine: () => {
      // The rebuild below will not put the discarded arrangement back: `hasRestored` is
      // already set, since restoring happens on the first load and only there.
      clearViewState(viewStateKeyRef.current);
      // The rebuild below keeps the history now, since it is the same file. Reset is the one
      // place that means to throw it away.
      undoStack.current = [];
      redoStack.current = [];
      setUndoDepth(0);
      setRedoDepth(0);
      setHonorPositions(honorPositionsDefault);
      // The rebuild puts every state back where its author had it.
      setReloadNonce((n) => n + 1);
    },
    zoomIn,
    zoomOut,
    zoom,
    setZoom,
    showNotes,
    toggleNotes: () => setShowNotes((on) => !on),
    snapToGrid,
    toggleSnapToGrid: () => setSnapToGrid((on) => !on),
    canUndo: undoDepth > 0,
    canRedo: redoDepth > 0,
    undo: () => step(undoStack, redoStack),
    redo: () => step(redoStack, undoStack),
    selectedState:
      parsed && selectedStateId ? describeState(parsed, selectedStateId, epsSymbol) : null,
    clearSelectedState: () => {
      setSelectedStateId(null);
      setSelectedEdge(null);
    },
    selectedTransition:
      parsed && selectedEdge
        ? describeEdge(parsed, selectedEdge.from, selectedEdge.to, epsSymbol)
        : null,
    zoomRange,
    fit: () => onResizeRef.current?.(),
    downloadSVG,
    downloadCurrent,
    copySVG,
    copyDescription,
    downloadPNG,
    copyPNG,
  };
}
