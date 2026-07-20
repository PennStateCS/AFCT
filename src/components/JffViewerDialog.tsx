'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { describeMachine, type MachineType } from '@/lib/jflap-parse';
import { useJffCytoscape, DEFAULT_EPS } from './useJffCytoscape';
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

// Grid overlay color (component-only; the engine styling lives in useJffCytoscape).
const GRID_COLOR =
  typeof window !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue('--grid-color').trim() ||
      '#0f172a'
    : '#0f172a';

/* ───────────────────────────── Viewer component ────────────────────────── */

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
  // The cytoscape engine (fetch/parse/layout/interaction + zoom/export actions) lives in
  // a hook; this component owns only the toolbar chrome and the grid overlay.
  const {
    containerRef,
    error,
    type,
    honorPositions,
    toggleHonorPositions,
    zoomIn,
    zoomOut,
    fit,
    downloadSVG,
    downloadPNG,
    copyPNG,
    parsed,
  } = useJffCytoscape({ src, title, epsSymbol, darkMode, honorPositionsDefault });

  // Non-visual alternative. The canvas is unreadable to a screen reader, and reading
  // automata is the point of this viewer, so the same machine is also published as text:
  // a one-line summary attached to the graph, plus the full state/transition listing.
  const description = parsed ? describeMachine(parsed, epsSymbol) : null;
  const summaryId = 'jff-graph-summary';
  const [showText, setShowText] = useState(false);

  const [grid, setGrid] = useState(showGridDefault);

  // Grid lines read the theme var live (subtle light gray in light mode, subtle
  // dark line in dark mode), falling back to the load-time color.
  const gridLine = `var(--grid-color, ${GRID_COLOR})`;
  const backgroundStyle: React.CSSProperties = grid
    ? {
        backgroundImage: `linear-gradient(${gridLine} 1px, transparent 1px), linear-gradient(90deg, ${gridLine} 1px, transparent 1px)`,
        backgroundSize: '24px 24px',
        backgroundPosition: 'center center',
      }
    : {};

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

  // White fill so the outline/idle buttons stand out against the gray toolbar.
  const controlBtnClass = 'bg-card';

  return (
    <div className="bg-card w-full overflow-hidden rounded-md border">
      {/* Toolbar: muted gray so it reads as a distinct control strip above the white body */}
      <div className="bg-background flex items-center justify-between gap-2 overflow-x-auto border-b p-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* Title is shown in the dialog header above; only the type label lives here. */}
          <TypeBadge t={type} />
        </div>
        <div className="flex items-center gap-2">
          {/* View controls */}
          <div className="flex items-center gap-1" role="group" aria-label="View controls">
            <Button
              size="sm"
              variant={grid ? 'default' : 'outline'}
              className={grid ? undefined : controlBtnClass}
              onClick={() => setGrid((s) => !s)}
              title="Toggle grid"
              aria-label="Toggle grid"
              aria-pressed={grid}
            >
              <Grid className="mr-2 h-4 w-4" /> Grid
            </Button>
            <Button
              size="sm"
              variant={honorPositions ? 'default' : 'outline'}
              className={honorPositions ? undefined : controlBtnClass}
              onClick={toggleHonorPositions}
              title="Original Positions"
              aria-label="Original positions"
              aria-pressed={honorPositions}
            >
              <Waypoints className="mr-2 h-4 w-4" />
              Original Positions
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={controlBtnClass}
              onClick={zoomOut}
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={controlBtnClass}
              onClick={zoomIn}
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={controlBtnClass}
              onClick={fit}
              title="Fit"
              aria-label="Fit to view"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>

          {/* Separator between control groups */}
          <div className="bg-muted-foreground/40 mx-0.5 h-6 w-px shrink-0" aria-hidden="true" />

          {/* Export controls */}
          <div className="flex items-center gap-1" role="group" aria-label="Export controls">
            <Button
              size="sm"
              variant="outline"
              className={controlBtnClass}
              onClick={downloadSVG}
              title="Download SVG"
              aria-label="Download SVG"
            >
              <Download className="mr-2 h-4 w-4" /> SVG
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={controlBtnClass}
              onClick={downloadPNG}
              title="Download PNG"
              aria-label="Download PNG"
            >
              <ImageDown className="mr-2 h-4 w-4" /> PNG
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={controlBtnClass}
              onClick={copyPNG}
              title="Copy PNG to clipboard"
              aria-label="Copy PNG to clipboard"
            >
              <Copy className="mr-2 h-4 w-4" /> Copy PNG
            </Button>
          </div>
        </div>
      </div>

      {/* The rendered graph. role="img" + a description keeps a screen reader from
          wandering into cytoscape's internals while still conveying what it shows. */}
      <div
        ref={containerRef}
        style={{ height, ...backgroundStyle }}
        className="bg-card relative overflow-hidden"
        role="img"
        aria-label={title ? `Diagram of ${title}` : 'Automaton diagram'}
        aria-describedby={description ? summaryId : undefined}
      >
        {error ? <div className="p-4 text-sm text-red-600">{error}</div> : null}
      </div>

      {description ? (
        <div className="border-t px-3 py-2">
          <p id={summaryId} className="text-muted-foreground text-xs">
            {description.summary}
          </p>

          <button
            type="button"
            onClick={() => setShowText((v) => !v)}
            aria-expanded={showText}
            aria-controls="jff-text-representation"
            className="text-foreground focus-visible:ring-ring mt-1 rounded text-xs underline focus-visible:ring-2 focus-visible:outline-none"
          >
            {showText ? 'Hide text representation' : 'Show text representation'}
          </button>

          {/* Kept mounted so aria-controls always resolves. */}
          <div id="jff-text-representation" hidden={!showText} className="mt-2 text-xs">
            {description.isEmpty ? (
              <p className="text-muted-foreground">
                This file contains no states, so there is nothing to describe.
              </p>
            ) : (
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">States</dt>
                <dd>{description.stateNames.join(', ')}</dd>

                <dt className="text-muted-foreground">Initial state</dt>
                <dd>{description.initialState ?? 'Not set'}</dd>

                <dt className="text-muted-foreground">Final states</dt>
                <dd>{description.finalStates.length ? description.finalStates.join(', ') : 'None'}</dd>

                <dt className="text-muted-foreground">Transitions</dt>
                <dd>
                  {description.transitionLines.length === 0 ? (
                    'None'
                  ) : (
                    <ul className="list-none space-y-0.5">
                      {description.transitionLines.map((line, i) => (
                        <li key={`${line}-${i}`}>{line}</li>
                      ))}
                    </ul>
                  )}
                </dd>
              </dl>
            )}
          </div>
        </div>
      ) : null}
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
      <DialogContent
        className="bg-card max-h-[calc(100vh-2rem)] !max-w-none overflow-auto p-0"
        style={{ width }}
      >
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
