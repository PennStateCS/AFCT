/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Grid, Waypoints, Download, ImageDown, Copy, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

/* ───────────────────────────── Types & consts ───────────────────────────── */

type MachineType = 'fa' | 'pda' | 'tm' | 'unknown';

type Parsed = {
  type: MachineType;
  states: { id: string; name: string; xPos: number, yPos: number, initial: boolean; final: boolean }[];
  transitions: Array<{
    from: string;
    to: string;
    read?: string;
    write?: string; // TM
    move?: string;  // TM (L/R/S)
    pop?: string;   // PDA
    push?: string;  // PDA
    __idx: number;  // original XML order
  }>;
};

const NODE_FILL = '#fff59d';
const STROKE = '#1f2937';
const TEXT = '#111827';
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
  else if (rawType.includes('fa') || rawType.includes('finite') || rawType.includes('dfa') || rawType.includes('nfa'))
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
      const pop  = t.pop  || eps;
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
    if (line.length <= maxLen) { out.push(line); continue; }
    let s = line.trim();
    while (s.length > maxLen) {
      const slice = s.slice(0, maxLen + 8);
      const idx =
        slice.lastIndexOf(' ') >= 14 ? slice.lastIndexOf(' ') :
        slice.lastIndexOf(',') >= 14 ? slice.lastIndexOf(',') :
        slice.lastIndexOf(';') >= 14 ? slice.lastIndexOf(';') :
        slice.lastIndexOf('|') >= 14 ? slice.lastIndexOf('|') :
        maxLen;
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
  maxLen = 26
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
    const lines = items.map(i => i.text);
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

  const initialStates = parsed.states.filter((s) => s.initial);
  const startBits = initialStates.flatMap((s, idx) => ([
    { data: { id: `__start${idx}`, label: '' }, classes: 'start' },
    { data: { id: `__startEdge${idx}`, source: `__start${idx}`, target: s.id, label: '' }, classes: 'startEdge' }
  ]));

  return [...nodes, ...edges, ...startBits];
}

/* ────────────────────────────── Export helpers ─────────────────────────── */

async function downloadDataUrl(filename: string, dataUrl: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
async function copyText(txt: string) {
  try { await navigator.clipboard.writeText(txt); } catch {}
}

/* ───────────────────────────── Viewer component ────────────────────────── */

export function JffCytoscapeViewer({
  src, title, height = '72vh', epsSymbol = DEFAULT_EPS, darkMode = false, showGridDefault = false, honorPositionsDefault = false,
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

  // Debug
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugParsed, setDebugParsed] = useState<any>(null);
  const [debugElements, setDebugElements] = useState<any>(null);
  const [debugElk, setDebugElk] = useState<any>(null);

  const gridBg = grid
    ? 'linear-gradient(#e5e7eb 1px, transparent 1px), linear-gradient(90deg, #e5e7eb 1px, transparent 1px)'
    : 'none';
  const backgroundStyle: React.CSSProperties = grid
    ? { backgroundImage: gridBg, backgroundSize: '24px 24px', backgroundPosition: 'center center' }
    : {};

  const load = useMemo(
    () => async () => {
      setError(null);
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
        const text = await res.text();

        const parsed = parseJflap(text);
        setType(parsed.type);
        setDebugParsed({
          type: parsed.type,
          stateCount: parsed.states.length,
          states: parsed.states.map(s => ({ id: s.id, name: s.name, x: s.xPos, y: s.yPos, initial: s.initial, final: s.final })),
          transitionCount: parsed.transitions.length
        });

        const elements = toElements(parsed, epsSymbol, honorPositions);
        setDebugElements(elements);

        const cytoscape = await ensureCytoscapeReady();

        if (cyRef.current) {
          cyRef.current.destroy();
          cyRef.current = null;
        }

        const cy = cytoscape({
          container: containerRef.current!,
          elements,
          wheelSensitivity: 0.2,
          minZoom: 0.2,
          maxZoom: 6,
          style: [
            /* nodes */
            {
              selector: 'node',
              style: {
                'background-color': darkMode ? '#0b1220' : NODE_FILL,
                'border-color': STROKE,
                'border-width': 2,
                'label': 'data(label)',
                'font-family': 'Inter, ui-sans-serif, system-ui',
                'font-size': 16,
                'color': TEXT,
                'text-valign': 'center',
                'text-halign': 'center',
                'width': 58,
                'height': 58,
                'shape': 'ellipse',
              }
            },
            { selector: 'node.final', style: { 'border-width': 6 } },
            { selector: 'node.start', style: { 'width': 10, 'height': 10, 'background-opacity': 0, 'border-opacity': 0 } },

            /* edges (default) */
            {
              selector: 'edge',
              style: {
                'curve-style': 'bezier',
                'line-color': STROKE,
                'width': EDGE_WIDTH,
                'target-arrow-color': STROKE,
                'source-arrow-color': STROKE,
                'source-arrow-shape': 'none',
                'target-arrow-shape': 'triangle',
                'arrow-scale': 1.1,
                'label': 'data(label)',
                'font-family': 'Inter, ui-sans-serif, system-ui',
                'font-size': 16,
                'min-zoomed-font-size': 7,
                'color': TEXT,
                'text-wrap': 'wrap',
                'text-max-width': 140,
                'text-rotation': 'autorotate',
                'text-margin-y': -12,
              }
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
                'text-margin-y': -32,
              }
            },

            /* initial arrow from hidden start node */
            {
              selector: 'edge.startEdge',
              style: {
                'line-color': STROKE,
                'target-arrow-color': STROKE,
                'target-arrow-shape': 'triangle',
                'arrow-scale': 1.1,
                'width': EDGE_WIDTH,
                'label': '',
              }
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
              }
            },
            { selector: '.faded', style: { 'opacity': 0.25 } },
          ],
          layout: { name: 'preset' },
        });

        cyRef.current = cy;

        // make sure zooming/panning are enabled
        cy.userZoomingEnabled(true);
        cy.panningEnabled(true);
        cy.userPanningEnabled(true);
        
        if (!honorPositions) {
          // ELK layout
          const elkAspectRatio = (!containerRef.current?.clientWidth || !containerRef.current?.clientHeight) ? '1.6f' :  `${containerRef.current?.clientWidth / containerRef.current?.clientHeight}f`;
          const elkOptions = {
            name: 'elk',
            nodeDimensionsIncludeLabels: true,
            fit: true,
            animate: false,
            elk: {
              algorithm: 'force',
              'elk.aspectRatio': elkAspectRatio,
              'elk.spacing.nodeNode': '50',
            }
          };
          setDebugElk(elkOptions);

          await new Promise<void>((resolve) =>
            cy.layout(elkOptions).run().on('layoutstop', () => resolve())
          );
        } else {
          setDebugElk({ name: 'preset', usedPositions: true });
        }

        // reassert loop geometry after layout or preset
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
            'text-margin-y': -32,
          });
        });

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
          const neighborhood = ele.closedNeighborhood ? ele.closedNeighborhood() : ele.neighborhood();
          cy.elements().addClass('faded');
          neighborhood.addClass('highlighted').removeClass('faded');
        });

        cy.fit(undefined, 40);

        // keep size/zoom coherent if dialog resizes
        const onResize = () => { try { cy.resize(); } catch {} };
        window.addEventListener('resize', onResize, { passive: true });
        // store to cleanup
        (cy as any).__onResize = onResize;

      } catch (e: any) {
        console.error(e);
        setError(e?.message || 'Failed to render .jff');
      }
    },
    [src, epsSymbol, darkMode, honorPositions]
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

  /* ── 🔧 zoom helpers (animated, keep center fixed) ─────────────────────── */
  const animatedZoomTo = (level: number) => {
    const cy = cyRef.current; if (!cy) return;
    const min = typeof cy.minZoom === 'function' ? cy.minZoom() : 0.2;
    const max = typeof cy.maxZoom === 'function' ? cy.maxZoom() : 6;
    const next = Math.max(min, Math.min(max, level));
    cy.animate(
      { zoom: next, renderedPosition: cy.renderedCenter() },
      { duration: 160, easing: 'ease-in-out' }
    );
  };
  const zoomIn = () => {
    const cy = cyRef.current; if (!cy) return;
    animatedZoomTo(cy.zoom() * 1.2);
  };
  const zoomOut = () => {
    const cy = cyRef.current; if (!cy) return;
    animatedZoomTo(cy.zoom() / 1.2);
  };
  const fitAll = () => cyRef.current?.animate({ fit: { eles: cyRef.current.elements(), padding: 40 } }, { duration: 160 });
  const resetHighlight = () => cyRef.current?.elements().removeClass('faded highlighted');

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
      const ClipboardItemCtor: any = (globalThis as any).ClipboardItem || (window as any).ClipboardItem;
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

  const copyDebug = async () => {
    const payload = { parsed: debugParsed, elkOptions: debugElk, elements: debugElements };
    await copyText(JSON.stringify(payload, null, 2));
  };

  const TypeBadge = ({ t }: { t: MachineType }) => {
    const label =
      t === 'fa' ? 'Finite Automaton' : t === 'pda' ? 'Pushdown Automaton' : t === 'tm' ? 'Turing Machine' : 'Unknown';
    const cls =
      t === 'fa' ? 'bg-orange-100 text-orange-800'
      : t === 'pda' ? 'bg-purple-100 text-purple-800'
      : t === 'tm' ? 'bg-sky-100 text-sky-800'
      : 'bg-gray-100 text-gray-800';
    return <Badge variant="outline" className={cls}>{label}</Badge>;
  };

  return (
    <div className="w-full rounded-md border bg-white">
      <div className="flex items-center justify-between gap-2 border-b p-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="truncate text-sm font-medium">{title ?? src}</div>
          <TypeBadge t={type} />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <Button size="sm" variant={grid ? 'default' : 'outline'} onClick={() => setGrid((s) => !s)} title="Toggle grid">
            <Grid className="mr-2 h-4 w-4" /> Grid
          </Button>
          <Button size="sm" variant={honorPositions ? 'default' : 'outline'} onClick={() => setHonorPositions((p) => !p)} title="Original Positions">
            <Waypoints className="mr-2 h-4 w-4" />Original Positions
          </Button>
          <Button size="sm" variant="outline" onClick={zoomOut} title="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={zoomIn} title="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={fitAll} title="Fit">
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
          <Button size="sm" variant="outline" onClick={() => setDebugOpen(true)} title="Debug">
            {'<>'}
          </Button>
        </div>
      </div>

      <div ref={containerRef} style={{ height, ...backgroundStyle }} className="relative overflow-hidden">
        {error ? <div className="p-4 text-sm text-red-600">{error}</div> : null}
      </div>

      {debugOpen && (
        <div className="fixed inset-0 z-[100] bg-black/40">
          <div className="absolute inset-x-0 top-10 mx-auto w-[min(980px,92vw)] rounded-lg bg-white p-4 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">Debug</div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={copyDebug} title="Copy debug JSON">
                  <Copy className="mr-1 h-4 w-4" /> Copy
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDebugOpen(false)}>Close</Button>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded border p-2">
                <div className="mb-1 text-xs font-medium text-gray-500">Parsed</div>
                <pre className="max-h-72 overflow-auto text-xs">{JSON.stringify(debugParsed, null, 2)}</pre>
              </div>
              <div className="rounded border p-2">
                <div className="mb-1 text-xs font-medium text-gray-500">Elements</div>
                <pre className="max-h-72 overflow-auto text-[11px] leading-4">{JSON.stringify(debugElements, null, 2)}</pre>
              </div>
              <div className="rounded border p-2 md:col-span-2">
                <div className="mb-1 text-xs font-medium text-gray-500">ELK Options</div>
                <pre className="max-h-64 overflow-auto text-[11px] leading-4">{JSON.stringify(debugElk, null, 2)}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Dialog wrapper ──────────────────────────── */

export default function JffViewerDialog({
  open, onOpenChange, src, title,
  width = '80vw', height = '85vh',
  epsSymbol = DEFAULT_EPS, darkMode = false, showGridDefault = true,
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
      <DialogContent className="!max-w-none p-0 overflow-hidden" style={{ width }}>
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="truncate">{title ?? 'JFLAP Viewer'}</DialogTitle>
        </DialogHeader>
        <div className="h-full p-4 pt-2">
          <JffCytoscapeViewer
            src={src}
            title={title}
            height={height}
            epsSymbol={epsSymbol}
            darkMode={darkMode}
            showGridDefault={showGridDefault}
            honorPositionsDefault={honorPositionsDefault}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
