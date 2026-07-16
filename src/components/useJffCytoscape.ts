/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { bestStartNodePosition } from '@/lib/jflap-layout';
import { parseJflap, toElements, type MachineType } from '@/lib/jflap-parse';

/* ───────────────────────────── Types & consts ───────────────────────────── */

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

  // Customization variables
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

        // Pick the least-cluttered direction for the start-node stub.
        const pos = bestStartNodePosition(nodePos, otherNodePositions, incomingAngles);

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

        // Canvas labels need a concrete font-family string, and next/font
        // registers Geist under a hashed name, so read it off the body.
        const uiFontFamily =
          (typeof window !== 'undefined' && getComputedStyle(document.body).fontFamily) ||
          'ui-sans-serif, system-ui';

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
                'font-family': uiFontFamily,
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
                'font-family': uiFontFamily,
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
                const pos = bestStartNodePosition(nodePos, otherNodePositions, incomingAngles);
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
