/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { parseJflap, toElements, type MachineType, type Parsed } from '@/lib/jflap-parse';

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
  darkMode?: boolean;
  honorPositionsDefault?: boolean;
};

/**
 * Owns the JFLAP viewer's cytoscape engine: fetching + parsing the .jff, initializing
 * the graph, laying it out (ELK / preset), wiring interaction, and the zoom/fit/export
 * actions. Extracted from JffViewerDialog so that component is just the toolbar + canvas
 * chrome. Returns the container ref to mount the graph into, the load `error` and parsed
 * machine `type`, the `honorPositions` toggle (a layout input), and the action handlers.
 */
export function useJffCytoscape({
  src,
  title,
  epsSymbol = DEFAULT_EPS,
  darkMode = false,
  honorPositionsDefault = false,
}: UseJffCytoscapeOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<any | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [honorPositions, setHonorPositions] = useState(honorPositionsDefault);
  const [type, setType] = useState<MachineType>('unknown');
  // Kept so the viewer can render a text description of the machine; the canvas alone
  // is not a usable representation for a screen reader.
  const [parsed, setParsed] = useState<Parsed | null>(null);

  // Customization variables
  const FIT_PADDING = 80;
  // Ceiling on the zoom the initial fit may choose. Without one, fitting fills the canvas
  // whatever is in it, and a two-state machine arrived at roughly 4x. 1:1 turned out to
  // read as too distant on a large screen, so allow a moderate enlargement and no more.
  const MAX_INITIAL_ZOOM = 1.5;
  // How far the self-loop arcs out from the state. The label geometry that goes with it
  // lives in lib/jflap-layout, which is where LOOP_REACH records what this produces.
  const LOOP_STEP_SIZE = 48;

  // Expose onResize for Fit button
  const onResizeRef = useRef<(() => void) | null>(null);

  const load = useMemo(
    () => async () => {
      setError(null);
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
        const text = await res.text();

        const parsed = parseJflap(text);
        setType(parsed.type);
        setParsed(parsed);
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
                'background-opacity': 0,
                'border-color': STROKE,
                'border-width': 2,
                events: 'no',
              },
            },

            /* edges (default) */
            {
              selector: 'edge',
              style: {
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

        // make sure zooming/panning are enabled
        cy.userZoomingEnabled(true);
        cy.panningEnabled(true);
        cy.userPanningEnabled(true);

        // Expose fitAndResize for Fit button and initial layout
        onResizeRef.current = () => void fitAndResize();
        setTimeout(() => {
          onResizeRef.current?.();
        }, 0);

        // keep size/zoom coherent if dialog resizes
        const debouncedFitAndResize = debounce(() => void fitAndResize(), 160);
        window.addEventListener('resize', debouncedFitAndResize, { passive: true });
        (cy as any).__onResize = debouncedFitAndResize;

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
            return;
          }
          const ele = evt.target;
          // `events: 'no'` should stop a note being a tap target at all; this is the belt to
          // that brace, since a note has no neighbourhood and would fade the whole machine.
          if (ele.hasClass?.('note')) return;
          const neighborhood = ele.closedNeighborhood
            ? ele.closedNeighborhood()
            : ele.neighborhood();
          cy.elements().addClass('faded');
          neighborhood.addClass('highlighted').removeClass('faded');
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
    [src, epsSymbol, darkMode, honorPositions],
  );

  useEffect(() => {
    if (typeof window !== 'undefined') void load();
    return () => {
      const cy = cyRef.current;
      if (cy) {
        if ((cy as any).__onResize) window.removeEventListener('resize', (cy as any).__onResize);
        cy.destroy();
        cyRef.current = null;
      }
    };
  }, [load]);

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
    error,
    type,
    parsed,
    honorPositions,
    toggleHonorPositions: () => setHonorPositions((p) => !p),
    zoomIn,
    zoomOut,
    fit: () => onResizeRef.current?.(),
    downloadSVG,
    downloadPNG,
    copyPNG,
  };
}
