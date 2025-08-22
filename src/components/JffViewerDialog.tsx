/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  MarkerType,
  Node,
  Edge,
  Position,
  useReactFlow,
  Handle,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import { Maximize, Grid, Download, ZoomIn, ZoomOut } from 'lucide-react';

/* ── dynamic imports for browser-only libs ─────────────────────────────── */
let ELKClass: any = null;
async function getELK() {
  if (!ELKClass) ELKClass = (await import('elkjs/lib/elk.bundled.js')).default;
  return ELKClass;
}
async function toPNG(el: HTMLElement) {
  const { toPng } = await import('html-to-image');
  return toPng(el, { pixelRatio: 2, cacheBust: true });
}

/* ── parsing ───────────────────────────────────────────────────────────── */
type MachineType = 'fa' | 'pda' | 'tm' | 'unknown';
const EPS = 'ε';

function parseJflap(xmlText: string) {
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
    return { id, name, x, y, initial, final };
  });

  const transitions = Array.from(automaton.querySelectorAll('transition')).map((t, i) => {
    const from = String(t.querySelector('from')?.textContent ?? '').trim();
    const to = String(t.querySelector('to')?.textContent ?? '').trim();
    const read  = (t.querySelector('read')?.textContent ?? '').trim();
    const write = (t.querySelector('write')?.textContent ?? '').trim(); // TM
    const move  = (t.querySelector('move')?.textContent ?? '').trim();  // TM
    const pop   = (t.querySelector('pop')?.textContent ?? '').trim();   // PDA
    const push  = (t.querySelector('push')?.textContent ?? '').trim();  // PDA
    return { id: `e${i}`, from, to, read, write, move, pop, push };
  });

  return { type, states, transitions };
}

function formatLabel(
  t: { read?: string; write?: string; move?: string; pop?: string; push?: string },
  type: MachineType
) {
  switch (type) {
    case 'pda': {
      const read = t.read || EPS;
      const pop  = t.pop  || EPS;
      const push = t.push || EPS;
      return `${read}, ${pop} → ${push}`;
    }
    case 'tm': {
      const read  = t.read ?? '';
      const write = t.write ?? '';
      const move  = (t.move || 'S').toUpperCase(); // L/R/S
      return `${read || ' '} → ${write || ' '}, ${move}`;
    }
    case 'fa':
    default:
      return t.read || EPS;
  }
}

/* ── node / edge views ─────────────────────────────────────────────────── */
const NODE_SIZE = 64;

function StateNode({ data }: { data: { label: string; initial?: boolean; final?: boolean } }) {
  return (
    <div
      className={[
        'flex items-center justify-center rounded-full',
        'text-[13px] font-medium select-none',
        data.final ? 'ring-4 ring-slate-800' : 'ring-2 ring-slate-800',
        data.initial ? 'outline outline-2 outline-blue-500' : 'outline-none',
        'shadow-sm',
      ].join(' ')}
      style={{ width: NODE_SIZE, height: NODE_SIZE, background: '#f1f5f9', position: 'relative' }}
    >
      <Handle type="target" id="l" position={Position.Left} style={{ opacity: 0, width: 8, height: 8 }} />
      <Handle type="source" id="r" position={Position.Right} style={{ opacity: 0, width: 8, height: 8 }} />
      {data.label}
    </div>
  );
}

type LabeledEdgeProps = {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  markerEnd?: any;
  data?: { label?: string };
};
function LabeledEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, data }: LabeledEdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY });
  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={{ stroke: '#0f172a', strokeWidth: 2 }} />
      {data?.label ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: 'white',
              padding: '2px 6px',
              fontSize: 12,
              borderRadius: 4,
              boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
              whiteSpace: 'nowrap',
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const nodeTypes = { stateNode: StateNode };
const edgeTypes = { labeled: LabeledEdge };

/* ── inner canvas (uses hooks) ─────────────────────────────────────────── */
type InnerProps = {
  nodes: Node[];
  edges: Edge[];
  title?: string;
  height: number | string;
  grid: boolean;
};

function InnerFlow({ nodes, edges, title, height, grid }: InnerProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const { fitView, zoomTo, zoomIn, zoomOut, getZoom } = useReactFlow();

  const defaultEdgeOptions = useMemo(
    () => ({
      style: { strokeWidth: 2, stroke: '#0f172a' },
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      type: 'labeled' as const,
    }),
    []
  );

  // Tighter fit + bump zoom so it fills the dialog nicely
  useEffect(() => {
    if (!nodes.length && !edges.length) return;
    const id = requestAnimationFrame(() => {
      try {
        fitView({ padding: 0.04 }); // smaller padding = larger model
        requestAnimationFrame(() => zoomTo(Math.min(2.5, (getZoom?.() ?? 1) * 1.4)));
      } catch {}
    });
    return () => cancelAnimationFrame(id);
  }, [nodes.length, edges.length, fitView, zoomTo, getZoom]);

  const handleDownload = useCallback(async () => {
    const el = wrapRef.current?.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (!el) return;
    const dataUrl = await toPNG(el);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${(title ?? 'automaton').replace(/\s+/g, '_')}.png`;
    a.click();
  }, [title]);

  const proOptions = useMemo(() => ({ hideAttribution: true }), []);

  return (
    <div className="w-full rounded-md border bg-white">
      <div className="flex items-center justify-between gap-2 border-b p-2">
        <div className="truncate text-sm font-medium">{title ?? 'Automaton'}</div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => fitView({ padding: 0.04 })} title="Fit">
            <Maximize className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => zoomIn?.()} title="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => zoomOut?.()} title="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={handleDownload} title="Download PNG">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div ref={wrapRef} style={{ height }} className="relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          proOptions={proOptions}
          fitView
          fitViewOptions={{ padding: 0.04 }}
          defaultEdgeOptions={defaultEdgeOptions}
          panOnScroll
          zoomOnScroll
          minZoom={0.1}
          maxZoom={4}
        >
          {grid && <Background gap={24} size={1} />}
          <MiniMap pannable zoomable nodeStrokeColor={() => '#0f172a'} nodeColor={() => '#e2e8f0'} />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>
    </div>
  );
}

/* ── exported viewer ───────────────────────────────────────────────────── */
type ViewerProps = {
  src: string;                // URL to .jff
  title?: string;
  height?: number | string;   // e.g. '70vh'
};

export default function JflapFlowViewer({ src, title, height = '65vh' }: ViewerProps) {
  const [grid, setGrid] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`Failed to fetch: ${src}`);
      const text = await res.text();

      const { type, states, transitions } = parseJflap(text);

      const rfNodes: Node[] = states.map((s) => ({
        id: s.id,
        type: 'stateNode',
        data: { label: s.name, initial: s.initial, final: s.final },
        position: Number.isFinite(s.x) && Number.isFinite(s.y) ? { x: s.x, y: s.y } : { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        width: NODE_SIZE,
        height: NODE_SIZE,
      }));

      const rfEdges: Edge[] = transitions.map((t) => ({
        id: t.id,
        source: t.from,
        target: t.to,
        sourceHandle: 'r',
        targetHandle: 'l',
        data: { label: formatLabel(t, type) },
        type: 'labeled',
        style: { stroke: '#0f172a', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      }));

      // layout if any node lacks coordinates
      const needsLayout = rfNodes.some((n) => n.position.x === 0 && n.position.y === 0);
      if (needsLayout) {
        const ELK = await getELK();
        const elk = new ELK();
        const graph = {
          id: 'root',
          children: rfNodes.map((n) => ({ id: n.id, width: NODE_SIZE, height: NODE_SIZE })),
          edges: rfEdges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
          layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': 'RIGHT',
            'elk.layered.nodeSpacing': '40',
            'elk.layered.layerSpacing': '60',
            'elk.padding': '16',
          },
        } as any;

        const layout = await elk.layout(graph);
        const pos = new Map<string, any>((layout.children ?? []).map((c: any) => [c.id, c]));
        rfNodes.forEach((n) => {
          const p = pos.get(n.id);
          if (p) n.position = { x: p.x + p.width / 2, y: p.y + p.height / 2 };
        });
      }

      setNodes(rfNodes);
      setEdges(rfEdges);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to render file');
    }
  }, [src]);

  useEffect(() => {
    if (typeof window !== 'undefined') load();
  }, [load]);

  return (
    <ReactFlowProvider>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-medium truncate">{title ?? src}</div>
        <Button size="sm" variant={grid ? 'default' : 'outline'} onClick={() => setGrid((s) => !s)}>
          <Grid className="mr-1 h-4 w-4" /> {grid ? 'Hide grid' : 'Show grid'}
        </Button>
      </div>

      {error ? (
        <div className="p-4 text-sm text-red-600">{error}</div>
      ) : (
        <InnerFlow nodes={nodes} edges={edges} title={title} height={height} grid={grid} />
      )}
    </ReactFlowProvider>
  );
}
