/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Grid, Download, RefreshCw } from 'lucide-react';

type MachineType = 'fa' | 'pda' | 'tm' | 'unknown';
const EPS = 'λ';

/* ----------------------------- .jff parsing ----------------------------- */
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

function parseJflap(xmlText: string): Parsed {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
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

/* ------------------------------- labeling ------------------------------- */

function labelFor(
  t: Parsed['transitions'][number],
  type: MachineType
) {
  switch (type) {
    case 'pda': {
      const read = t.read || EPS;
      const pop = t.pop || EPS;
      const push = t.push || EPS;
      // JFLAP style spacing & punctuation: read , pop ; push
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
      return t.read || EPS;
  }
}

/** Merge parallel edges and keep label order as in the XML. Use \n for multi-line JFLAP-like labels. */
function bundleEdges(
  transitions: Parsed['transitions'],
  type: MachineType
): Array<{ from: string; to: string; label: string }> {
  const map = new Map<string, { idx: number; text: string }[]>();
  for (const tr of transitions) {
    const key = `${tr.from}→${tr.to}`;
    const arr = map.get(key) ?? [];
    arr.push({ idx: tr.__idx, text: labelFor(tr, type) });
    map.set(key, arr);
  }
  return Array.from(map.entries()).map(([key, items]) => {
    items.sort((a, b) => a.idx - b.idx); // preserve .jff ordering
    const [from, to] = key.split('→');
    return { from, to, label: items.map(i => i.text).join('\\n') };
  });
}

/* ------------------------------- DOT gen -------------------------------- */

function dotEscape(s: string) {
  return s.replace(/"/g, '\\"');
}

function toDOT(parsed: Parsed): string {
  const { states, transitions, type } = parsed;
  const edgeList = bundleEdges(transitions, type);

  const lines: string[] = [];

  lines.push('digraph G {');
    lines.push('graph [bgcolor=transparent];');
    lines.push('  graph [bgcolor=transparent, margin="0.3,0.0", pad=0.2];');
  lines.push('  rankdir=LR;');
  lines.push('  splines=true;');
  lines.push('  nodesep=0.5; ranksep=0.9;');
  lines.push('  fontname="Inter";');
  lines.push('  node [shape=circle, style="filled", fillcolor="#eef2f7", color="#0f172a", fontname="Inter", fontsize=13];');
  lines.push('  edge [color="#0f172a", penwidth=2, arrowsize=0.8, fontname="Inter", fontsize=12];');

  // states (doublecircle for finals)
  for (const s of states) {
    const shape = s.final ? 'doublecircle' : 'circle';
    lines.push(`  "${dotEscape(s.id)}" [label="${dotEscape(s.name)}", shape=${shape}];`);
  }

  // initial arrow(s)
  const initials = states.filter((s) => s.initial);
  initials.forEach((s, i) => {
    const starter = `__start${i}`;
    lines.push(`  "${starter}" [shape=point, width=0.1, label=""];`);
    lines.push(`  "${starter}" -> "${dotEscape(s.id)}" [arrowhead=normal, arrowsize=0.8];`);
  });

  // edges (self-loops on top like JFLAP using headport/tailport=n)
  for (const e of edgeList) {
    const isSelf = e.from === e.to;
    const extras = isSelf ? ', headport=n, tailport=n, labeldistance=1.3, labelangle=45' : '';
    lines.push(`  "${dotEscape(e.from)}" -> "${dotEscape(e.to)}" [label="${dotEscape(e.label)}"${extras}];`);
  }

  lines.push('}');
  return lines.join('\n');
}

/* --------------------------- Graphviz rendering -------------------------- */

async function renderDotToSVG(dot: string): Promise<string> {
  const { default: Viz } = await import('viz.js');
  const { Module, render } = await import('viz.js/full.render.js');
  const viz = new (Viz as any)({ Module, render });

  let svg: string = await viz.renderString(dot);

  // Make SVG responsive
  svg = svg
    .replace(/\swidth="[^"]*"/, '')
    .replace(/\sheight="[^"]*"/, '')
    .replace('<svg', '<svg style="width:100%;height:100%"');

  // 🔑 Remove Graphviz background polygon/fill
  svg = svg.replace(/<polygon fill="[^"]*" stroke="none" points="[^"]*"\s*\/>/, '');
  svg = svg.replace(/fill="white"/g, 'fill="transparent"');

  return svg;
}

/* ------------------------- Public viewer component ----------------------- */

export function JffSvgViewer({
  src,
  title,
  height = '72vh',
}: {
  src: string;
  title?: string;
  height?: number | string;
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

  const load = useMemo(
    () => async () => {
      setError(null);
      setSvg(null);
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`Failed to fetch: ${src}`);
        const text = await res.text();

        const parsed = parseJflap(text);
        setType(parsed.type);
        const dot = toDOT(parsed);
        const svg = await renderDotToSVG(dot);
        setSvg(svg);
      } catch (e: any) {
        console.error(e);
        setError(e?.message || 'Failed to render .jff');
      }
    },
    [src]
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
            <Download className="h-4 w-4" />
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

/* ---------------------------- Dialog wrapper ---------------------------- */

export default function JffViewerDialog({
  open,
  onOpenChange,
  src,
  title,
  width = '80vw',   // easy width control
  height = '85vh',  // inner viewer height
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  src: string;
  title?: string;
  /** CSS length for dialog width (e.g., '80vw', '95vw', '1200px', '100vw') */
  width?: string;
  /** CSS length for inner viewer height (e.g., '72vh', '85vh', '600px') */
  height?: number | string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-none p-0 overflow-hidden" style={{ width }}>
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="truncate">{title ?? 'JFLAP Viewer'}</DialogTitle>
        </DialogHeader>
        <div className="h-full p-4 pt-2">
          <JffSvgViewer src={src} title={title} height={height} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
