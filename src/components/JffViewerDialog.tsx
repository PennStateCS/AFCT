/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Grid,
  Waypoints,
  Download,
  ImageDown,
  Copy,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from 'lucide-react';

/* ───────────────────────────── Types & consts ───────────────────────────── */

type MachineType = 'fa' | 'pda' | 'tm' | 'unknown';

type Parsed = {
  type: MachineType;
  states: {
    id: string;
    name: string;
    xPos: number;
    yPos: number;
    initial: boolean;
    final: boolean;
  }[];
  transitions: Array<{
    from: string;
    to: string;
    read?: string;
    write?: string; // TM
    move?: string; // TM (L/R/S)
    pop?: string; // PDA
    push?: string; // PDA
    __idx: number; // original XML order
  }>;
};

const NODE_FILL =
  typeof window !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue('--node-color').trim() ||
      '#38bdf8'
    : '#38bdf8';
const STROKE =
  typeof window !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim() ||
      '#0f172a'
    : '#0f172a';
const TEXT_COLOR =
  typeof window !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim() ||
      '#0f172a'
    : '#0f172a';
const GRID_COLOR =
  typeof window !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue('--grid-color').trim() ||
      '#0f172a'
    : '#0f172a';


const EDGE_WIDTH = 1.6;
const DEFAULT_EPS = 'λ';

/* ────────────────────────────── Parse .jff ─────────────────────────────── */

function parseJflap(xmlText: string): Parsed {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    const msg = parseError.textContent?.split('\n')[0]?.trim() || 'XML parse error';
    throw new Error(`Invalid JFLAP (.jff) file: ${msg}`);
  }

  const automaton = doc.querySelector('structure > automaton') ?? doc;

  const rawType = (doc.querySelector('type')?.textContent || '').toLowerCase();
  let type: MachineType = 'unknown';
  if (rawType.includes('pda')) type = 'pda';
  else if (rawType.includes('turing') || rawType.includes('tm')) type = 'tm';
  else if (
    rawType.includes('fa') ||
    rawType.includes('finite') ||
    rawType.includes('dfa') ||
    rawType.includes('nfa')
  )
    type = 'fa';

  const states = Array.from(automaton.querySelectorAll('state')).map((s, i) => {
    const id = String(s.getAttribute('id') ?? i).trim();
    const name = s.getAttribute('name') ?? s.querySelector('name')?.textContent ?? `q${i}`;
    const xPos = parseInt(s.querySelector('x')?.textContent ?? '0');
    const yPos = parseInt(s.querySelector('y')?.textContent ?? '0');
    const initial = !!s.querySelector('initial');
    const final = !!s.querySelector('final');
    return { id, name, xPos, yPos, initial, final };
  });

  const transitions = Array.from(automaton.querySelectorAll('transition')).map((t, idx) => {
    const from = String(t.querySelector('from')?.textContent ?? '').trim();
    const to = String(t.querySelector('to')?.textContent ?? '').trim();
    const read = (t.querySelector('read')?.textContent ?? '').trim();
    const write = (t.querySelector('write')?.textContent ?? '').trim();
    const move = (t.querySelector('move')?.textContent ?? '').trim();
    const pop = (t.querySelector('pop')?.textContent ?? '').trim();
    const push = (t.querySelector('push')?.textContent ?? '').trim();
    return { from, to, read, write, move, pop, push, __idx: idx };
  });

  return { type, states, transitions };
}

/* ───────────────────────── Label formatting & wrap ─────────────────────── */

function labelFor(t: Parsed['transitions'][number], type: MachineType, eps: string) {
  switch (type) {
    case 'pda': {
      const read = t.read || eps;
      const pop = t.pop || eps;
      const push = t.push || eps;
      return `${read} , ${pop} ; ${push}`;
    }
    case 'tm': {
      const read = t.read ?? '';
      const write = t.write ?? '';
      const move = (t.move || 'S').toUpperCase();
      return `${read || ' '} → ${write || ' '}, ${move}`;
    }
    case 'fa':
    default:
      return t.read || eps;
  }
}

function wrapLines(lines: string[], maxLen = 26): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.length <= maxLen) {
      out.push(line);
      continue;
    }
    let s = line.trim();
    while (s.length > maxLen) {
      const slice = s.slice(0, maxLen + 8);
      const idx =
        slice.lastIndexOf(' ') >= 14
          ? slice.lastIndexOf(' ')
          : slice.lastIndexOf(',') >= 14
            ? slice.lastIndexOf(',')
            : slice.lastIndexOf(';') >= 14
              ? slice.lastIndexOf(';')
              : slice.lastIndexOf('|') >= 14
                ? slice.lastIndexOf('|')
                : maxLen;
      out.push(s.slice(0, idx).trim());
      s = s.slice(idx).replace(/^[\s,;|]+/, '');
    }
    if (s) out.push(s);
  }
  return out;
}

function bundleEdges(
  transitions: Parsed['transitions'],
  type: MachineType,
  eps: string,
  wrap = true,
  maxLen = 26,
): Array<{ from: string; to: string; label: string }> {
  const map = new Map<string, { idx: number; text: string }[]>();
  for (const tr of transitions) {
    const key = `${tr.from}→${tr.to}`;
    const arr = map.get(key) ?? [];
    arr.push({ idx: tr.__idx, text: labelFor(tr, type, eps) });
    map.set(key, arr);
  }

  return Array.from(map.entries()).map(([key, items]) => {
    // JFLAP shows later-entered transitions first
    items.sort((a, b) => b.idx - a.idx);
    const [from, to] = key.split('→');
    const lines = items.map((i) => i.text);
    const finalLines = wrap ? wrapLines(lines, maxLen) : lines;
    return { from, to, label: finalLines.join('\n') };
  });
}

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

/* ───────────────────── Convert parsed → Cytoscape elements ─────────────── */

function toElements(parsed: Parsed, eps: string, honorPositions?: boolean) {
  const nodes = parsed.states.map((s) => {
    const base = {
      data: { id: s.id, label: s.name, final: s.final ? 1 : 0, initial: s.initial ? 1 : 0 },
      classes: s.final ? 'final' : '',
    };
    if (honorPositions) {
      return {
        ...base,
        position: { x: s.xPos, y: s.yPos },
        locked: false,
        grabbable: true,
      };
    }
    return base;
  });

  const edgesBundled = bundleEdges(parsed.transitions, parsed.type, eps, true, 26);
  const edges = edgesBundled.map((e, i) => ({
    data: {
      id: `e${i}-${e.from}-${e.to}`,
      source: e.from,
      target: e.to,
      label: e.label,
      isLoop: e.from === e.to ? 1 : 0,
    },
  }));
  return [...nodes, ...edges];
}

/* ────────────────────────────── Export helpers ─────────────────────────── */

async function downloadDataUrl(filename: string, dataUrl: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

/* ───────────────────────────── Viewer component ────────────────────────── */

// Debounce utility for resize
function debounce(fn: () => void, ms: number) {
  let timer: any;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

export function JffCytoscapeViewer({
  src,
  title,
  height = '72vh',
  epsSymbol = DEFAULT_EPS,
  darkMode = false,
  showGridDefault = false,
  honorPositionsDefault = false,
}: {
  src: string;
  title?: string;
  height?: number | string;
  epsSymbol?: string;
  darkMode?: boolean;
  showGridDefault?: boolean;
  honorPositionsDefault?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<any | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [grid, setGrid] = useState(showGridDefault);
  const [honorPositions, setHonorPositions] = useState(honorPositionsDefault);
  const [type, setType] = useState<MachineType>('unknown');

  //

  const backgroundStyle: React.CSSProperties = grid
    ? {
        backgroundImage:
          `linear-gradient(${GRID_COLOR} 1px, transparent 1px), linear-gradient(90deg, ${GRID_COLOR} 1px, transparent 1px)`,
        backgroundSize: '24px 24px',
        backgroundPosition: 'center center',
      }
    : {};

  // Customization variables
  const NODE_DIAMETER = 58;
  const FIT_PADDING = 80;

  // Expose onResize for Fit button
  const onResizeRef = useRef<(() => void) | null>(null);

  // Utility: Reposition start nodes for !honorPositions
  function repositionStartNodes(cy: any) {
    // For each initial node, ensure a start node and edge exist, and position the start node
    cy.nodes()
      .filter((n: any) => n.data('initial'))
      .forEach((node: any, idx: number) => {
        const nodePos = node.position();
        const directions = Array.from({ length: 8 }, (_, i) => i * (Math.PI / 4)); // 0, 45, ..., 315 deg
        const radius = 1.5 * NODE_DIAMETER;

        // Exclude both the current node and its corresponding start node from the calculation
        const startNodeId = `__start${idx}`;
        const otherNodes = cy
          .nodes()
          .filter((n2: any) => n2.id() !== node.id() && n2.id() !== startNodeId);
        const otherNodePositions = otherNodes.map((n2: any) => n2.position());

        // Gather incoming edge angles
        const incomingEdges = node.incomers('edge');
        const incomingAngles = incomingEdges.map((e: any) => {
          const src = e.source().position();
          return Math.atan2(nodePos.y - src.y, nodePos.x - src.x);
        });

        // For each direction, compute a clutter score
        const scores = directions.map((angle) => {
          // Position where start node would be placed
          const testX = nodePos.x + Math.cos(angle) * radius;
          const testY = nodePos.y + Math.sin(angle) * radius;

          // Score: sum of inverse distances to other nodes (closer = higher score)
          let score = 0;
          for (const pos of otherNodePositions) {
            const dx = testX - pos.x;
            const dy = testY - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < NODE_DIAMETER * 1.1)
              score += 1000; // heavy penalty for overlap
            else score += 1 / dist;
          }

          // Penalty for being close to incoming edge directions
          for (const edgeAngle of incomingAngles) {
            let diff = Math.abs(angle - edgeAngle);
            if (diff > Math.PI) diff = 2 * Math.PI - diff;
            if (diff < Math.PI / 6) score += 10; // penalty for being within 30deg of an incoming edge
          }
          return score;
        });

        // Find the direction with the lowest score
        let bestIdx = 0;
        let bestScore = scores[0];
        for (let i = 1; i < scores.length; ++i) {
          if (scores[i] < bestScore) {
            bestScore = scores[i];
            bestIdx = i;
          }
        }

        // Apply best angle
        const bestAngle = directions[bestIdx];
        const pos = {
          x: nodePos.x + Math.cos(bestAngle) * radius,
          y: nodePos.y + Math.sin(bestAngle) * radius,
        };

        let startNode = cy.getElementById(`__start${idx}`);
        if (!startNode || startNode.empty()) {
          // Create the start node if it doesn't exist
          cy.add({
            group: 'nodes',
            data: { id: `__start${idx}` },
            position: pos,
            classes: 'start',
          });
          startNode = cy.getElementById(`__start${idx}`);
        } else {
          startNode.position(pos);
        }
        // Ensure the start edge exists
        const startEdgeId = `__startEdge${idx}`;
        const startEdge = cy.getElementById(startEdgeId);
        if (!startEdge || startEdge.empty()) {
          cy.add({
            group: 'edges',
            data: {
              id: startEdgeId,
              source: `__start${idx}`,
              target: node.id(),
              label: '',
            },
            classes: 'startEdge',
          });
        }
      });
  }

  const load = useMemo(
    () => async () => {
      setError(null);
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
        const text = await res.text();

        const parsed = parseJflap(text);
        setType(parsed.type);
        const elements = toElements(parsed, epsSymbol, honorPositions);

        if (!containerRef.current) {
          return;
        }

        const cytoscape = await ensureCytoscapeReady();

        if (cyRef.current) {
          cyRef.current.destroy();
          cyRef.current = null;
        }

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
                'border-color': STROKE,
                'border-width': 2,
                label: 'data(label)',
                'font-family': 'Inter, ui-sans-serif, system-ui',
                'font-size': 16,
                color: TEXT_COLOR,
                'text-valign': 'center',
                'text-halign': 'center',
                width: 58,
                height: 58,
                shape: 'ellipse',
              },
            },
            { selector: 'node.final', style: { 'border-width': 6 } },
            {
              selector: 'node.start',
              style: { width: 4, height: 4, 'background-opacity': 0, 'border-opacity': 0 },
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
                'font-family': 'Inter, ui-sans-serif, system-ui',
                'font-size': 16,
                'min-zoomed-font-size': 7,
                color: TEXT_COLOR,
                'text-wrap': 'wrap',
                'text-max-width': 140,
                'text-rotation': 'autorotate',
              },
            },
            /* self-loops on TOP with arrow at start */
            {
              selector: 'edge[isLoop = 1]',
              style: {
                'curve-style': 'loop',
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

            /* initial arrow from hidden start node - make it only node diameter away */
            {
              selector: 'edge.startEdge',
              style: {
                'curve-style': 'straight',
                'line-color': STROKE,
                'target-arrow-color': STROKE,
                'target-arrow-shape': 'triangle',
                'arrow-scale': 1.1,
                width: EDGE_WIDTH,
                label: '',
                'source-endpoint': 'outside-to-node',
                'target-endpoint': 'outside-to-node',
                'segment-distances': 58, // node diameter
                'segment-weights': 1,
              },
            },

            /* interaction */
            {
              selector: '.highlighted',
              style: {
                'line-color': '#2563eb',
                'target-arrow-color': '#2563eb',
                'source-arrow-color': '#2563eb',
                'border-color': '#2563eb',
                'background-color': darkMode ? '#0b1220' : NODE_FILL,
              },
            },
            { selector: '.faded', style: { opacity: 0.25 } },
          ],
          layout: { name: 'preset' },
        });

        // Function to set label margins based on edge angle
        async function updateEdgeLabelMargins() {
          cy.edges().forEach((edge: any) => {
            const src = edge.source().position();
            const tgt = edge.target().position();
            const dx = tgt.x - src.x;
            const dy = tgt.y - src.y;
            const angle = Math.atan2(dy, dx); // radians

            // Project margin away from the midpoint, perpendicular to the edge
            const marginDistance = 12;
            const marginX = Math.round(Math.cos(angle + Math.PI / 2) * marginDistance);
            const marginY = Math.round(Math.sin(angle + Math.PI / 2) * marginDistance);
            edge.style({
              'text-margin-x': marginX,
              'text-margin-y': marginY,
            });
          });
        }

        // Function to update the self-loop geometry of the transition label
        async function selfLoopGeometry() {
          cy.edges('[isLoop = 1]').forEach((e: any) => {
            e.style({
              'curve-style': 'loop',
              'loop-direction': '0deg',
              'loop-sweep': '50deg',
              'control-point-step-size': 48,
              'source-arrow-shape': 'triangle',
              'target-arrow-shape': 'none',
              'arrow-scale': 0.95,
              'line-cap': 'round',
              'text-rotation': 'none',
              'text-margin-y': -12,
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
              layoutOptions = {
                name: 'elk',
                nodeDimensionsIncludeLabels: true,
                elk: {
                  algorithm: 'force',
                  'elk.aspectRatio': elkAspectRatio,
                  'elk.spacing.nodeNode': '50',
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

            // Fit and center using cy.center(cy.nodes())
            const nodes = cy.nodes();
            if (nodes.length === 0) return;

            // Calculate fit zoom (preserve previous logic for zoom, but use cy.center for center)
            let minX = Infinity,
              minY = Infinity,
              maxX = -Infinity,
              maxY = -Infinity;
            nodes.forEach((n: any) => {
              const pos = n.position();
              if (pos.x < minX) minX = pos.x;
              if (pos.y < minY) minY = pos.y;
              if (pos.x > maxX) maxX = pos.x;
              if (pos.y > maxY) maxY = pos.y;
            });

            // Add padding
            minX -= FIT_PADDING;
            minY -= FIT_PADDING;
            maxX += FIT_PADDING;
            maxY += FIT_PADDING;

            const fitWidth = maxX - minX;
            const fitHeight = maxY - minY;
            const scaleX = cy.width() / fitWidth;
            const scaleY = cy.height() / fitHeight;
            const fitZoom = Math.min(scaleX, scaleY, cy.maxZoom ? cy.maxZoom() : 6);

            // Use cy.center(cy.nodes()) to get the center position
            const center = cy.center(cy.nodes());
            cy.animate({ zoom: fitZoom, center }, { duration: 120 });
          } catch {}
        }

        cyRef.current = cy;

        // make sure zooming/panning are enabled
        cy.userZoomingEnabled(true);
        cy.panningEnabled(true);
        cy.userPanningEnabled(true);

        // Expose fitAndResize for Fit button and initial layout
        onResizeRef.current = fitAndResize;
        setTimeout(() => {
          onResizeRef.current?.();
        }, 0);

        // keep size/zoom coherent if dialog resizes
        const debouncedFitAndResize = debounce(fitAndResize, 160);
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
          const neighborhood = ele.closedNeighborhood
            ? ele.closedNeighborhood()
            : ele.neighborhood();
          cy.elements().addClass('faded');
          neighborhood.addClass('highlighted').removeClass('faded');
        });

        // Update self-loop geometry, edge label margins, and start node position when a node is moved
        cy.on('position', async (evt: any) => {
          // Only update if a node was moved
          if (evt.target && evt.target.isNode && evt.target.isNode()) {
            await updateEdgeLabelMargins();
            await selfLoopGeometry();

            // If the moved node is an initial node, update its corresponding __start node position
            if (evt.target.data('initial')) {
              // Find the index of this initial node among all initial nodes
              const initialNodes = cy.nodes().filter((n: any) => n.data('initial'));
              let idx = -1;
              initialNodes.forEach((n: any, i: number) => {
                if (n.id() === evt.target.id()) idx = i;
              });
              if (idx !== -1) {
                // Recompute the best position for the __start node
                const node = evt.target;
                const nodePos = node.position();
                const directions = Array.from({ length: 8 }, (_, i) => i * (Math.PI / 4));
                const radius = 1.5 * 58; // NODE_DIAMETER
                const startNodeId = `__start${idx}`;
                const otherNodes = cy
                  .nodes()
                  .filter((n2: any) => n2.id() !== node.id() && n2.id() !== startNodeId);
                const otherNodePositions = otherNodes.map((n2: any) => n2.position());
                const incomingEdges = node.incomers('edge');
                const incomingAngles = incomingEdges.map((e: any) => {
                  const src = e.source().position();
                  return Math.atan2(nodePos.y - src.y, nodePos.x - src.x);
                });
                const scores = directions.map((angle) => {
                  const testX = nodePos.x + Math.cos(angle) * radius;
                  const testY = nodePos.y + Math.sin(angle) * radius;
                  let score = 0;
                  for (const pos of otherNodePositions) {
                    const dx = testX - pos.x;
                    const dy = testY - pos.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 58 * 1.1) score += 1000;
                    else score += 1 / dist;
                  }
                  for (const edgeAngle of incomingAngles) {
                    let diff = Math.abs(angle - edgeAngle);
                    if (diff > Math.PI) diff = 2 * Math.PI - diff;
                    if (diff < Math.PI / 6) score += 10;
                  }
                  return score;
                });
                let bestIdx = 0;
                let bestScore = scores[0];
                for (let i = 1; i < scores.length; ++i) {
                  if (scores[i] < bestScore) {
                    bestScore = scores[i];
                    bestIdx = i;
                  }
                }
                const bestAngle = directions[bestIdx];
                const pos = {
                  x: nodePos.x + Math.cos(bestAngle) * radius,
                  y: nodePos.y + Math.sin(bestAngle) * radius,
                };
                const startNode = cy.getElementById(startNodeId);
                if (startNode && !startNode.empty()) {
                  startNode.position(pos);
                }
              }
            }
          }
        });
      } catch (e: any) {
        console.error(e);
        setError(e?.message || 'Failed to render .jff');
      }
    },
    [src, epsSymbol, darkMode, honorPositions],
  );

  useEffect(() => {
    if (typeof window !== 'undefined') load();
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

  const downloadPNG = async () => {
    if (!cyRef.current) return;
    const dataUrl: string = cyRef.current.png({ scale: 2, full: true, bg: null });
    await downloadDataUrl(`${(title ?? 'automaton').replace(/\s+/g, '_')}.png`, dataUrl);
  };

  const copyPNG = async () => {
    if (!cyRef.current) return;
    try {
      const dataUrl: string = cyRef.current.png({ scale: 2, full: true, bg: null });
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

  const TypeBadge = ({ t }: { t: MachineType }) => {
    const label =
      t === 'fa'
        ? 'Finite Automaton'
        : t === 'pda'
          ? 'Pushdown Automaton'
          : t === 'tm'
            ? 'Turing Machine'
            : 'Unknown';
    const cls =
      t === 'fa'
        ? 'bg-orange-100 text-orange-800'
        : t === 'pda'
          ? 'bg-purple-100 text-purple-800'
          : t === 'tm'
            ? 'bg-sky-100 text-sky-800'
            : 'bg-gray-100 text-gray-800';
    return (
      <Badge variant="outline" className={cls}>
        {label}
      </Badge>
    );
  };

  return (
    <div className="bg-background w-full rounded-md border">
      <div className="flex items-center justify-between gap-2 overflow-x-auto border-b p-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-sm font-medium">{title ?? src}</div>
          <TypeBadge t={type} />
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={grid ? 'default' : 'outline'}
            onClick={() => setGrid((s) => !s)}
            title="Toggle grid"
          >
            <Grid className="mr-2 h-4 w-4" /> Grid
          </Button>
          <Button
            size="sm"
            variant={honorPositions ? 'default' : 'outline'}
            onClick={() => setHonorPositions((p) => !p)}
            title="Original Positions"
          >
            <Waypoints className="mr-2 h-4 w-4" />
            Original Positions
          </Button>
          <Button size="sm" variant="outline" onClick={zoomOut} title="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={zoomIn} title="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onResizeRef.current?.();
            }}
            title="Fit"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={downloadSVG} title="Download SVG">
            <Download className="mr-2 h-4 w-4" /> SVG
          </Button>
          <Button size="sm" variant="outline" onClick={downloadPNG} title="Download PNG">
            <ImageDown className="mr-2 h-4 w-4" /> PNG
          </Button>
          <Button size="sm" variant="outline" onClick={copyPNG} title="Copy PNG to clipboard">
            <Copy className="mr-2 h-4 w-4" /> Copy PNG
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        style={{ height, ...backgroundStyle }}
        className="relative overflow-hidden"
      >
        {error ? <div className="p-4 text-sm text-red-600">{error}</div> : null}
      </div>
    </div>
  );
}

/* ───────────────────────────── Dialog wrapper ──────────────────────────── */

export default function JffViewerDialog({
  open,
  onOpenChange,
  src,
  title,
  width = '80vw',
  height = '85vh',
  epsSymbol = DEFAULT_EPS,
  darkMode = false,
  showGridDefault = true,
  honorPositionsDefault = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  src: string;
  title?: string;
  width?: string;
  height?: number | string;
  epsSymbol?: string;
  darkMode?: boolean;
  showGridDefault?: boolean;
  honorPositionsDefault?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-none max-h-[calc(100vh-2rem)] overflow-auto p-0" style={{ width }}>
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="truncate">{title ?? 'JFLAP Viewer'}</DialogTitle>
        </DialogHeader>
        <div className="h-full p-4 pt-2">
          {open ? (
            <JffCytoscapeViewer
              src={src}
              title={title}
              height={height}
              epsSymbol={epsSymbol}
              darkMode={darkMode}
              showGridDefault={showGridDefault}
              honorPositionsDefault={honorPositionsDefault}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
