/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Grid, Download, RefreshCw, ImageDown } from 'lucide-react';

/* ───────────────────────────── Types & consts ───────────────────────────── */

type MachineType = 'fa' | 'pda' | 'tm' | 'unknown';

type Parsed = {
  type: MachineType;
  states: { id: string; name: string; x?: number; y?: number; initial: boolean; final: boolean }[];
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

const DEFAULT_EPS = 'λ'; // JFLAP-style empty symbol
const DEFAULT_MARGIN_LR = '0.35,0.00'; // inches: left/right, top/bottom
const DEFAULT_PAD = 0.2;

/* ────────────────────────────── Parse .jff ─────────────────────────────── */

function parseJflap(xmlText: string): Parsed {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');

  // Friendly error if malformed XML
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
    const x = Number(s.querySelector('x')?.textContent ?? NaN);
    const y = Number(s.querySelector('y')?.textContent ?? NaN);
    const initial = !!s.querySelector('initial');
    const final = !!s.querySelector('final');
    return { id, name, x: Number.isFinite(x) ? x : undefined, y: Number.isFinite(y) ? y : undefined, initial, final };
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

function labelFor(
  t: Parsed['transitions'][number],
  type: MachineType,
  eps: string
) {
  switch (type) {
    case 'pda': {
      const read = t.read || eps;
      const pop  = t.pop  || eps;
      const push = t.push || eps;
      // JFLAP punctuation: read , pop ; push
      return `${read} , ${pop} ; ${push}`;
    }
    case 'tm': {
      const read = t.read ?? '';
      const write = t.write ?? '';
      const move = (t.move || 'S').toUpperCase(); // L/R/S
      return `${read || ' '} → ${write || ' '}, ${move}`;
    }
    case 'fa':
    default:
      return t.read || eps;
  }
}

/** simple soft-wrap: break long segments on space/comma/semicolon/pipes */
function wrapLines(lines: string[], maxLen = 26): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.length <= maxLen) { out.push(line); continue; }
    let s = line.trim();
    while (s.length > maxLen) {
      // find a break opportunity near maxLen
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

/** Merge parallel edges; preserve XML order; return HTML labels with <BR/> */
function bundleEdges(
  transitions: Parsed['transitions'],
  type: MachineType,
  eps: string,
  wrap = true,
  maxLen = 26
): Array<{ from: string; to: string; htmlLabel: string }> {
  const map = new Map<string, { idx: number; text: string }[]>();
  for (const tr of transitions) {
    const key = `${tr.from}→${tr.to}`;
    const arr = map.get(key) ?? [];
    arr.push({ idx: tr.__idx, text: labelFor(tr, type, eps) });
    map.set(key, arr);
  }
  const escHtml = (s: string) =>
    s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  return Array.from(map.entries()).map(([key, items]) => {
    items.sort((a,b) => a.idx - b.idx);
    const [from, to] = key.split('→');

    // split to individual lines, optionally wrap long lines
    const lines = items.map(i => i.text);
    const finalLines = wrap ? wrapLines(lines, maxLen) : lines;

    // HTML-like label with <BR/> so Graphviz stacks lines cleanly
    const htmlLabel = `<${finalLines.map(l => escHtml(l)).join('<BR ALIGN="CENTER"/>')}>`;
    return { from, to, htmlLabel };
  });
}

/* ───────────────────────────── DOT generation ─────────────────────────── */

function dotEscape(s: string) {
  return s.replace(/"/g, '\\"');
}

type DotOptions = {
  eps?: string;
  marginLR?: string; // e.g., '0.35,0.00'
  pad?: number;      // e.g., 0.2
  honorPositions?: boolean;
  wrapLabels?: boolean;
  wrapWidth?: number;
  darkMode?: boolean;
};

function toDOT(parsed: Parsed, opts: DotOptions = {}): string {
  const {
    eps = DEFAULT_EPS,
    marginLR = DEFAULT_MARGIN_LR,
    pad = DEFAULT_PAD,
    honorPositions = false,
    wrapLabels = true,
    wrapWidth = 26,
    darkMode = false,
  } = opts;

  const { states, transitions, type } = parsed;

  // If honorPositions is requested but most nodes lack coords, fall back to dot
  const posCount = states.filter(s => Number.isFinite(s.x) && Number.isFinite(s.y)).length;
  const honor = honorPositions && posCount >= Math.max(1, Math.floor(states.length * 0.6));

  const edgeList = bundleEdges(transitions, type, eps, wrapLabels, wrapWidth);

  const stroke = darkMode ? '#e5e7eb' : '#0f172a';
  const nodeFill = darkMode ? '#0b1220' : '#eef2f7';

  const lines: string[] = [];
  lines.push('digraph G {');
  lines.push(`  graph [bgcolor=transparent, margin="${marginLR}", pad=${pad}];`);
  lines.push(`  layout=${honor ? 'neato' : 'dot'};`);
  if (honor) {
    lines.push('  overlap=false;');
    lines.push('  splines=true;');
  } else {
    lines.push('  rankdir=LR;');
    lines.push('  splines=true;');
    lines.push('  nodesep=0.5; ranksep=0.9;');
  }
  lines.push('  fontname="Inter";');
  lines.push(`  node [shape=circle, style="filled", fillcolor="${nodeFill}", color="${stroke}", fontname="Inter", fontsize=13, penwidth=2];`);
  lines.push(`  edge [color="${stroke}", penwidth=2, arrowsize=0.8, fontname="Inter", fontsize=12];`);

  // states (peripheries=2 for final states -> bolder double ring)
  for (const s of states) {
    const periph = s.final ? ', peripheries=2' : '';
    const pos = honor && s.x !== undefined && s.y !== undefined ? `, pos="${s.x},${-s.y}!"` : '';
    lines.push(`  "${dotEscape(s.id)}" [label="${dotEscape(s.name)}"${periph}${pos}];`);
  }

  // initial arrow(s)
  const initials = states.filter((s) => s.initial);
  initials.forEach((s, i) => {
    const starter = `__start${i}`;
    lines.push(`  "${starter}" [shape=point, width=0.1, label=""];`);
    lines.push(`  "${starter}" -> "${dotEscape(s.id)}" [arrowhead=normal, arrowsize=0.8];`);
  });

  // edges (self-loops at top; nicer spacing)
  for (const e of edgeList) {
    const isSelf = e.from === e.to;
    const extras = isSelf
      ? ', headport=n, tailport=n, minlen=2, labeldistance=1.4, labelangle=55'
      : ', minlen=1';
    // Use HTML-like label (no quotes) so <BR/> is respected
    lines.push(`  "${dotEscape(e.from)}" -> "${dotEscape(e.to)}" [label=${e.htmlLabel}${extras}];`);
  }

  lines.push('}');
  return lines.join('\n');
}

/* ─────────────────────────── Graphviz rendering ────────────────────────── */

// Reuse a single Viz instance for faster re-renders
let vizSingleton: any | null = null;
async function getViz() {
  if (vizSingleton) return vizSingleton;
  const { default: Viz } = await import('viz.js');
  const { Module, render } = await import('viz.js/full.render.js');
  vizSingleton = new (Viz as any)({ Module, render });
  return vizSingleton;
}

async function renderDotToSVG(dot: string): Promise<string> {
  const viz = await getViz();
  let svg: string = await viz.renderString(dot);

  // Make SVG responsive & transparent
  svg = svg
    .replace(/\swidth="[^"]*"/, '')
    .replace(/\sheight="[^"]*"/, '')
    .replace('<svg', '<svg style="width:100%;height:100%"');

  // Remove Graphviz background polygon/fill if any
  svg = svg.replace(/<polygon fill="[^"]*" stroke="none" points="[^"]*"\s*\/>/, '');
  svg = svg.replace(/fill="white"/g, 'fill="transparent"');

  return svg;
}

/* ───────────────────────────── Viewer component ────────────────────────── */

export function JffSvgViewer({
  src,
  title,
  height = '72vh',
  honorPositions = false,
  darkMode = false,
  epsSymbol = DEFAULT_EPS,
  labelWrapWidth = 26,
}: {
  src: string;
  title?: string;
  height?: number | string;
  /** Use coordinates from .jff (x,y), else Graphviz DOT layout */
  honorPositions?: boolean;
  /** Optional dark palette (nodes still solid) */
  darkMode?: boolean;
  /** Choose which empty symbol to render (e.g., 'λ' or 'ε') */
  epsSymbol?: string;
  /** Line wrap width for labels */
  labelWrapWidth?: number;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grid, setGrid] = useState(true);
  const [type, setType] = useState<MachineType>('unknown');
  const containerRef = useRef<HTMLDivElement | null>(null);

  const gridBg = grid
    ? 'linear-gradient(#e5e7eb 1px, transparent 1px), linear-gradient(90deg, #e5e7eb 1px, transparent 1px)'
    : 'none';

  const backgroundStyle: React.CSSProperties = grid
    ? { backgroundImage: gridBg, backgroundSize: '24px 24px', backgroundPosition: 'center center' }
    : {};

  const downloadSVG = async () => {
    if (!containerRef.current) return;
    const el = containerRef.current.querySelector('svg');
    if (!el) return;
    const xml = new XMLSerializer().serializeToString(el);
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title ?? 'automaton').replace(/\s+/g, '_')}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPNG = async () => {
    if (!containerRef.current) return;
    const el = containerRef.current as HTMLElement;
    const { toPng } = await import('html-to-image');
    const dataUrl = await toPng(el, { pixelRatio: 2, cacheBust: true });
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${(title ?? 'automaton').replace(/\s+/g, '_')}.png`;
    a.click();
  };

  const load = useMemo(
    () => async () => {
      setError(null);
      setSvg(null);
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
        const text = await res.text();

        const parsed = parseJflap(text);
        setType(parsed.type);

        const dot = toDOT(parsed, {
          eps: epsSymbol,
          marginLR: DEFAULT_MARGIN_LR,
          pad: DEFAULT_PAD,
          honorPositions,
          wrapLabels: true,
          wrapWidth: labelWrapWidth,
          darkMode,
        });

        const svg = await renderDotToSVG(dot);
        setSvg(svg);
      } catch (e: any) {
        console.error(e);
        setError(e?.message || 'Failed to render .jff');
      }
    },
    [src, honorPositions, darkMode, epsSymbol, labelWrapWidth]
  );

  useEffect(() => {
    if (typeof window !== 'undefined') load();
  }, [load]);

  const TypeBadge = ({ t }: { t: MachineType }) => {
    const label =
      t === 'fa' ? 'Finite Automaton' : t === 'pda' ? 'Pushdown Automaton' : t === 'tm' ? 'Turing Machine' : 'Unknown';
    const cls =
      t === 'fa'
        ? 'bg-orange-100 text-orange-800'
        : t === 'pda'
        ? 'bg-purple-100 text-purple-800'
        : t === 'tm'
        ? 'bg-sky-100 text-sky-800'
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
        <div className="flex items-center gap-2">
          <Button size="sm" variant={grid ? 'default' : 'outline'} onClick={() => setGrid((s) => !s)}>
            <Grid className="mr-1 h-4 w-4" /> {grid ? 'Hide grid' : 'Show grid'}
          </Button>
          <Button size="sm" variant="outline" onClick={load} title="Re-render">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={downloadSVG} title="Download SVG">
            <Download className="mr-2 h-4 w-4" />
            SVG
          </Button>
          <Button size="sm" variant="outline" onClick={downloadPNG} title="Download PNG">
            <ImageDown className="mr-2 h-4 w-4" />
            PNG
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        style={{ height, ...backgroundStyle }}
        className="relative overflow-auto"
      >
        {error ? (
          <div className="p-4 text-sm text-red-600">{error}</div>
        ) : svg ? (
           
          <div className="w-full h-full" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">Rendering…</div>
        )}
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
  width = '80vw',        // dialog width
  height = '85vh',       // inner viewer height
  honorPositions = false,
  darkMode = false,
  epsSymbol = DEFAULT_EPS,
  labelWrapWidth = 26,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  src: string;
  title?: string;
  /** CSS length for dialog width (e.g., '80vw', '95vw', '1200px', '100vw') */
  width?: string;
  /** CSS length for inner viewer height (e.g., '72vh', '85vh', '600px') */
  height?: number | string;
  /** Honor coordinates from .jff positions if present */
  honorPositions?: boolean;
  /** Optional dark palette (nodes remain solid) */
  darkMode?: boolean;
  /** Choose which empty symbol to render (e.g., 'λ' or 'ε') */
  epsSymbol?: string;
  /** Line wrap width for labels */
  labelWrapWidth?: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-none p-0 overflow-hidden" style={{ width }}>
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="truncate">{title ?? 'JFLAP Viewer'}</DialogTitle>
        </DialogHeader>
        <div className="h-full p-4 pt-2">
          <JffSvgViewer
            src={src}
            title={title}
            height={height}
            honorPositions={honorPositions}
            darkMode={darkMode}
            epsSymbol={epsSymbol}
            labelWrapWidth={labelWrapWidth}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
