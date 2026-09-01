'use client';

import { useState } from 'react';
import { useTheme } from 'next-themes';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { describeMachine, type MachineDescription, type MachineType } from '@/lib/jflap-parse';
import { cn } from '@/lib/utils';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Slider } from '@/components/ui/slider';
import {
  sliderToZoom,
  zoomPercentLabel,
  zoomToSlider,
  ZOOM_SLIDER_MAX,
  ZOOM_SLIDER_MIN,
} from '@/lib/zoom-scale';
import { useJffCytoscape, DEFAULT_EPS } from './useJffCytoscape';
import { OpenInWindowButton } from '@/components/dialogs/OpenInWindowButton';
import {
  useRegisterViewerActions,
  useViewerChromePresent,
} from '@/components/viewer/viewer-actions';
import { Grid, Download, ImageDown, Copy, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

/**
 * Fallback grid colour, used only if `--grid-color` is somehow absent.
 *
 * A plain constant, deliberately. It used to read the computed value off the document behind
 * a `typeof window` check, which meant the server rendered one colour and the browser
 * another: React reported a hydration mismatch on the first page that server-renders this
 * viewer, which the dialogs never did because they only ever mount after a click. Reading
 * computed styles during render is the thing that cannot be done here; the CSS variable does
 * the theming anyway, live, without any of this.
 */
const GRID_COLOR_FALLBACK = '#0f172a';

/**
 * The machine written out: states, transitions and any notes.
 *
 * One component because it now appears in two places and must not drift between them. In a
 * dialog it sits in a panel under the graph; in the standalone window the View menu opens it
 * in a window of its own, so the graph keeps the whole height.
 */
function MachineDescriptionList({ description }: { description: MachineDescription }) {
  return (
    <>
      {description.isEmpty ? (
        <p className="text-muted-foreground">
          This file contains no states or notes, so there is nothing to describe.
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

          {/* Only when there are any: an empty Notes row on every machine would be
              noise, and most files have none. Notes are drawn on the canvas only in
              "As drawn", so this is where they are always readable. */}
          {description.noteLines.length > 0 ? (
            <>
              <dt className="text-muted-foreground">Notes</dt>
              <dd>
                <ul className="list-none space-y-0.5">
                  {description.noteLines.map((line, i) => (
                    <li key={`${line}-${i}`}>{line}</li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
        </dl>
      )}
    </>
  );
}

/* ───────────────────────────── Viewer component ────────────────────────── */

export function JffCytoscapeViewer({
  src,
  title,
  height = '72vh',
  fill = false,
  epsSymbol = DEFAULT_EPS,
  darkMode,
  showGridDefault = false,
  honorPositionsDefault = false,
}: {
  src: string;
  title?: string;
  height?: number | string;
  /** Fill the parent instead of using `height`, for a viewer inside a sized container. */
  fill?: boolean;
  epsSymbol?: string;
  /**
   * Draw for a dark background. Defaults to the page's own theme.
   *
   * It used to default to `false`, and no caller ever passed it, so every diagram was drawn
   * with the light-theme edge and label colour whatever the page was set to. Left overridable
   * because the value has to be forced in tests, where there is no theme provider.
   */
  darkMode?: boolean;
  showGridDefault?: boolean;
  honorPositionsDefault?: boolean;
}) {
  // `resolvedTheme` rather than `theme`: the latter is "system" for most people, which says
  // nothing about which colours are actually on screen.
  const { resolvedTheme } = useTheme();
  const isDark = darkMode ?? resolvedTheme === 'dark';
  // The cytoscape engine (fetch/parse/layout/interaction + zoom/export actions) lives in
  // a hook; this component owns only the toolbar chrome and the grid overlay.
  const {
    containerRef,
    error,
    type,
    honorPositions,
    toggleHonorPositions,
    showNotes,
    toggleNotes,
    zoomIn,
    zoomOut,
    zoom,
    setZoom,
    zoomRange,
    fit,
    downloadSVG,
    downloadPNG,
    downloadCurrent,
    copyPNG,
    copySVG,
    copyDescription,
    parsed,
  } = useJffCytoscape({ src, title, epsSymbol, darkMode: isDark, honorPositionsDefault });

  // Non-visual alternative. The canvas is unreadable to a screen reader, and reading
  // automata is the point of this viewer, so the same machine is also published as text:
  // a one-line summary attached to the graph, plus the full state/transition listing.
  const description = parsed ? describeMachine(parsed, epsSymbol) : null;
  const summaryId = 'jff-graph-summary';
  const [showText, setShowText] = useState(false);

  const [grid, setGrid] = useState(showGridDefault);

  // In the standalone window a menu bar offers the grid and the layout, so the toolbar drops
  // them rather than showing the same two controls twice. False in every dialog, where the
  // toolbar is the only place they exist.
  const chromeHasViewControls = useViewerChromePresent();

  // Offered to any chrome around this viewer, which today means the standalone window's menu
  // bar. Registers nothing when there is no provider, so a dialog is unaffected. Declared
  // after the grid state because it publishes it: the menu shows the grid ticked or not, and
  // the toolbar button below stays the same control on the same state.
  useRegisterViewerActions(
    {
      downloadSVG,
      downloadPNG,
      downloadCurrent,
      copyPNG,
      copySVG,
      copyDescription,
      toggleGrid: () => setGrid((on) => !on),
      toggleNotes,
      fitToWindow: fit,
      showTextRepresentation: () => setShowText(true),
      // Set rather than toggled, so the menu's two options are a choice between states and
      // selecting the one already showing does nothing.
      setAsDrawn: () => {
        if (!honorPositions) toggleHonorPositions();
      },
      setAutoArranged: () => {
        if (honorPositions) toggleHonorPositions();
      },
    },
    { grid, notes: showNotes, layout: honorPositions ? 'as-drawn' : 'auto' },
  );

  // Grid lines read the theme var live (subtle light gray in light mode, subtle dark line in
  // dark mode). The literal is only a fallback, and being a literal is what keeps the server
  // and client markup identical.
  const gridLine = `var(--grid-color, ${GRID_COLOR_FALLBACK})`;
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
        ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200'
        : t === 'pda'
          ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200'
          : t === 'tm'
            ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200'
            : 'bg-muted text-muted-foreground';
    return (
      <Badge variant="outline" className={cls}>
        {label}
      </Badge>
    );
  };

  // White fill so the outline/idle buttons stand out against the gray toolbar.
  const controlBtnClass = 'bg-card';

  return (
    <div
      className={cn(
        'bg-card w-full overflow-hidden border',
        // Rounded and fully bordered as a card inside a dialog. In the standalone window it is
        // the window's content rather than a card in it, and the rounding would put a gap
        // between the title tab and the toolbar it is meant to sit on.
        chromeHasViewControls ? 'rounded-none border-0' : 'rounded-md',
        fill && 'flex h-full flex-col',
      )}
    >
      {/* Toolbar: muted gray so it reads as a distinct control strip above the white body */}
      {/* Wraps rather than overflowing: in the Similarity tab's side-by-side comparison this
          toolbar sits in a half-width pane, where a single row ran its controls into each
          other. At full width it still fits on one line. */}
      <div className="bg-background flex shrink-0 flex-wrap items-center justify-between gap-2 border-b p-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* Title is shown in the dialog header above; only the type label lives here. */}
          <TypeBadge t={type} />
        </div>
        <div className="flex items-center gap-2">
          {/* View controls */}
          <div className="flex items-center gap-1" role="group" aria-label="View controls">
            {chromeHasViewControls ? null : (
              <>
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
                {/* Both choices are named and on screen. This was one button labelled
                    "Original Positions", which named only the state it was in: with it
                    un-pressed there was nothing to say what you were looking at instead, and
                    "positions" described the node coordinates rather than anything the reader
                    of a diagram thinks about. */}
                <span className="text-muted-foreground ml-1 text-sm whitespace-nowrap">Layout</span>
                <SegmentedControl
                  name="jff-layout"
                  ariaLabel="Layout"
                  value={honorPositions ? 'as-drawn' : 'auto'}
                  onValueChange={(next) => {
                    if ((next === 'as-drawn') !== honorPositions) toggleHonorPositions();
                  }}
                  options={[
                    { value: 'as-drawn', label: 'As drawn' },
                    { value: 'auto', label: 'Auto-arranged' },
                  ]}
                />
              </>
            )}
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
            {/* Between the two buttons, which is where the thing they both change belongs.
                Log scale, so 100% sits near the middle instead of against the left end; see
                lib/zoom-scale. The value is spoken as a percentage, because "62" means
                nothing to somebody who cannot see the graph. */}
            <Slider
              className="w-20 shrink-0 sm:w-28"
              min={ZOOM_SLIDER_MIN}
              max={ZOOM_SLIDER_MAX}
              step={1}
              value={[zoomToSlider(zoom, zoomRange().min, zoomRange().max)]}
              onValueChange={([next]) => {
                const { min, max } = zoomRange();
                if (next !== undefined) setZoom(sliderToZoom(next, min, max));
              }}
              aria-label="Zoom"
              aria-valuetext={zoomPercentLabel(zoom)}
            />
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

          {/* Exporting moves into the menu bar in the standalone window, so the
              toolbar drops the whole group there rather than carrying a second copy
              of it. The separator goes with them: a divider with nothing after it. */}
          {chromeHasViewControls ? null : (
            <>
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
            </>
          )}
        </div>
      </div>

      {/*
        A render failure, outside the graph container.
        `role="img"` makes everything inside the container presentational, so an error message
        placed in there was never reachable: a file that failed to parse announced as "Diagram
        of x.jff, image" and nothing else, with no text alternative either, because there is
        nothing parsed to describe.
      */}
      {error ? (
        <p role="alert" className="text-destructive px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      {/* The rendered graph. role="img" + a description keeps a screen reader from
          wandering into cytoscape's internals while still conveying what it shows. */}
      <div
        ref={containerRef}
        // In fill mode the flex track supplies the height; an inline one would fight it.
        style={fill ? backgroundStyle : { height, ...backgroundStyle }}
        // The ordinary arrow at rest, a closed hand while the button is down and the graph is
        // being dragged. Not an open hand throughout: that reads as "this whole surface is a
        // handle" over a diagram whose states and transitions are the things worth pointing
        // at. `cursor` inherits, so the canvases cytoscape puts inside pick this up without
        // being styled themselves.
        className={cn(
          'bg-card relative cursor-default overflow-hidden active:cursor-grabbing',
          fill && 'min-h-0 flex-1',
        )}
        role="img"
        aria-label={
          error
            ? 'The diagram could not be drawn'
            : title
              ? `Diagram of ${title}`
              : 'Automaton diagram'
        }
        aria-describedby={description ? summaryId : undefined}
      />

      {description ? (
        chromeHasViewControls ? (
          <>
            {/* The summary is still here, just not on screen. It is what `aria-describedby` on
          the canvas points at, and a canvas with no text alternative is unreadable to a
          screen reader, so it is hidden visually rather than removed. */}
            <p id={summaryId} className="sr-only">
              {description.summary}
            </p>
            <Dialog open={showText} onOpenChange={setShowText}>
              <DialogContent className="max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Text representation</DialogTitle>
                  <DialogDescription>{description.summary}</DialogDescription>
                </DialogHeader>
                <div className="text-sm">
                  <MachineDescriptionList description={description} />
                </div>
              </DialogContent>
            </Dialog>
          </>
        ) : (
          // Capped and scrollable on its own: the listing can be long, and it must not steal
          // height from the graph or grow the dialog. Focusable with it, because past the
          // toggle there is nothing tabbable, so the states and transitions this panel exists
          // to expose could not be scrolled to by keyboard.
          <div
            className="max-h-40 shrink-0 overflow-y-auto border-t px-3 py-2"
            tabIndex={0}
            role="group"
            aria-label="Description of this file"
          >
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
              <MachineDescriptionList description={description} />
            </div>
          </div>
        )
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
  darkMode,
  showGridDefault = true,
  honorPositionsDefault = true,
  windowHref,
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
  /** Link to the standalone window, or absent when one cannot be built for this file. */
  windowHref?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A column bounded by the viewport, so the graph takes whatever is left after the
          header and never pushes the dialog past the screen. It used to be a fixed 85vh
          canvas inside an `overflow-auto` box that was itself capped at the viewport, so
          the two scrollbars were guaranteed: the parts simply added up to more than the
          screen. Nothing here scrolls now; the graph pans and zooms instead. */}
      <DialogContent
        className="flex h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] !max-w-none flex-col overflow-hidden p-0"
        style={{ width }}
      >
        <DialogHeader className="shrink-0 px-4 pt-4">
          {/* Wraps to a second line rather than truncating. These titles are a file name
              followed by the problem's own title, so the ellipsis landed mid-name and cut
              off the part that identifies the file. Two lines, then it clips.

              `leading-snug` overrides the shared title's `leading-none`: a line-height of
              exactly 1 leaves no room below the baseline, and clamping adds the
              `overflow: hidden` that turns that into a visible cut, beheading the
              descender of the j in every `.jff`. */}
          <div className="flex items-start justify-between gap-4 pr-6">
            <DialogTitle className="line-clamp-2 leading-snug break-words">
              {title ?? 'JFLAP Viewer'}
            </DialogTitle>
            {/* Beside the title rather than in the toolbar below: this is about the window
                the machine is in, not about how it is drawn. */}
            {windowHref ? <OpenInWindowButton href={windowHref} /> : null}
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 p-4 pt-2">
          {open ? (
            <JffCytoscapeViewer
              src={src}
              title={title}
              fill
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
