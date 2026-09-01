/** @vitest-environment jsdom */

import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import JffViewerDialog, { JffCytoscapeViewer } from './JffViewerDialog';
import { ViewerActionsProvider, useViewerActions } from '@/components/viewer/viewer-actions';

// The engine tests await an async load chain (fetch, parse, dynamic import, cytoscape
// ctor). On a CPU-starved CI runner that chain can take several seconds, so give this
// file generous headroom instead of racing vitest's 5s default. `retry` is the safety
// net for the residual case: this is an integration test that is correct but races the
// runner under full-suite contention, so a transient timeout shouldn't fail the build.
// Passed via a variable so `retry` (valid at runtime) isn't rejected by setConfig's
// stricter object-literal type.
const jffTestConfig = { testTimeout: 20000, retry: 2 };
vi.setConfig(jffTestConfig);

/* ─────────────────────── cytoscape engine mock (hoisted) ─────────────────── */
// The viewer sets cyRef.current right after cytoscape() returns and wraps the
// layout work in try/catch, so a chainable no-throw mock lets load() complete and
// exposes the toolbar handlers (zoom/fit/export) for assertion.
const h = vi.hoisted(() => {
  const chain: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'length') return 0;
      if (prop === 'empty') return () => true;
      if (prop === 'position' || prop === 'center') return () => ({ x: 0, y: 0 });
      if (prop === 'id') return () => 'n';
      if (prop === 'data') return () => undefined;
      if (prop === 'isNode') return () => false;
      if (typeof prop === 'symbol') return undefined;
      return () => chain;
    },
    apply() {
      return chain;
    },
  });

  const cy = {
    userZoomingEnabled: vi.fn(),
    panningEnabled: vi.fn(),
    userPanningEnabled: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
    nodes: vi.fn(() => chain),
    edges: vi.fn(() => chain),
    elements: vi.fn(() => chain),
    getElementById: vi.fn(() => chain),
    // Node positions, so the undo tests can watch an arrangement being restored.
    __positions: {} as Record<string, { x: number; y: number }>,
    add: vi.fn(() => chain),
    on: vi.fn(),
    // Records handlers so a test can fire a tap the way cytoscape would.
    __handlers: {} as Record<string, (evt: unknown) => void>,
    // The layout reports completion, as cytoscape's does. Without it the viewer's own
    // `await new Promise(resolve => layout.on('layoutstop', resolve))` never settles, so
    // everything after the fit silently never ran and looked untestable.
    layout: vi.fn(() => ({
      run: vi.fn(),
      on: vi.fn((_event: string, cb: () => void) => {
        cb();
      }),
    })),
    width: vi.fn(() => 800),
    height: vi.fn(() => 600),
    zoom: vi.fn(() => 1),
    minZoom: vi.fn(() => 0.2),
    maxZoom: vi.fn(() => 6),
    center: vi.fn(() => ({ x: 0, y: 0 })),
    animate: vi.fn(),
    svg: vi.fn(() => '<svg></svg>'),
    png: vi.fn(() => 'data:image/png;base64,AAAA'),
    // Selecting the note nodes, which the notes toggle styles.
    $: vi.fn(() => ({ style: vi.fn() })),
  };

  const ctor = Object.assign(
    vi.fn(() => cy),
    { use: vi.fn() },
  );
  return { cy, ctor };
});

vi.mock('cytoscape', () => ({ default: h.ctor }));
vi.mock('cytoscape-elk', () => ({ default: {} }));
vi.mock('cytoscape-svg', () => ({ default: {} }));

// Resolve the (mocked) cytoscape modules once, up front. The component loads them
// with dynamic import() for bundle-splitting; pre-warming Vitest's module registry
// here keeps that import() from re-resolving the graph mid-run, which is what stalls
// under full-suite CPU contention and made this file flaky.
beforeAll(async () => {
  await Promise.all([import('cytoscape'), import('cytoscape-elk'), import('cytoscape-svg')]);
});

// Keep the Dialog wrapper light (no Radix portal / a11y noise); it renders children.
vi.mock('@/components/ui/dialog', () =>
  import('@/test/mocks/ui').then((mod) => mod.dialogMock),
);

/* ──────────────────────────────── fixtures ──────────────────────────────── */

const FA_JFF = `<?xml version="1.0"?>
<structure>
  <type>fa</type>
  <automaton>
    <state id="0" name="q0"><x>0</x><y>0</y><initial/></state>
    <state id="1" name="q1"><x>120</x><y>0</y><final/></state>
    <transition><from>0</from><to>1</to><read>a</read></transition>
  </automaton>
</structure>`;

let fetchImpl: (url: string) => Promise<unknown>;
const okText = (text: string) => ({
  ok: true,
  status: 200,
  text: async () => text,
  json: async () => ({}),
  blob: async () => new Blob([text]),
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchImpl = async () => okText(FA_JFF);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => fetchImpl(url)),
  );
  // Export helpers create object URLs; jsdom doesn't implement them.
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Resolves once load() has instantiated the (mocked) cytoscape engine, i.e. cyRef
// is set and the toolbar handlers can drive it. Generous timeout, kept well under the
// file's 20s testTimeout: the load chain (fetch, parse, dynamic import, ctor) can be
// slow under full-suite CPU contention, and 5s raced vitest's default and flaked.
const waitForEngine = () => waitFor(() => expect(h.ctor).toHaveBeenCalled(), { timeout: 15000 });

/* ────────────────────────────────  tests  ───────────────────────────────── */

describe('JffCytoscapeViewer — load & error', () => {
  it('shows an error message when the source fetch fails', async () => {
    fetchImpl = async () => ({ ok: false, status: 404, statusText: 'Not Found', text: async () => '' });
    render(<JffCytoscapeViewer src="/api/files/solutions/x.jff" />);
    expect(await screen.findByText(/Failed to fetch: 404/)).toBeInTheDocument();
    // The engine is never constructed on a failed fetch.
    expect(h.ctor).not.toHaveBeenCalled();
  });

  it('parses the machine type and reflects it in the badge', async () => {
    render(<JffCytoscapeViewer src="/x.jff" />);
    expect(await screen.findByText('Finite Automaton')).toBeInTheDocument();
  });

  it('constructs the cytoscape engine after a successful load', async () => {
    render(<JffCytoscapeViewer src="/x.jff" />);
    await waitForEngine();
    expect(h.ctor).toHaveBeenCalled();
  });
});

describe('JffCytoscapeViewer — toolbar presence', () => {
  it('renders the view and export controls', async () => {
    render(<JffCytoscapeViewer src="/x.jff" />);
    for (const label of [
      'Toggle grid',
      'Zoom out',
      'Zoom in',
      'Fit automaton to view',
      'Download SVG',
      'Download PNG',
      'Copy PNG to clipboard',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });
});

describe('JffCytoscapeViewer — view toggles', () => {
  it('toggles the grid pressed-state on click', async () => {
    render(<JffCytoscapeViewer src="/x.jff" />);
    const grid = screen.getByRole('button', { name: 'Toggle grid' });
    expect(grid).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(grid);
    expect(grid).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(grid);
    expect(grid).toHaveAttribute('aria-pressed', 'false');
  });

  it('honors showGridDefault for the initial pressed-state', () => {
    render(<JffCytoscapeViewer src="/x.jff" showGridDefault />);
    expect(screen.getByRole('button', { name: 'Toggle grid' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('names both layouts, not just the one in use', () => {
    // The single "Original Positions" toggle this replaced left the other choice
    // unnamed: with the button un-pressed nothing said what you were looking at.
    render(<JffCytoscapeViewer src="/x.jff" />);
    expect(screen.getByRole('radiogroup', { name: 'Layout' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'As drawn' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Auto-arranged' })).toBeInTheDocument();
  });

  it('starts on the auto-arranged layout and switches to as-drawn on click', () => {
    render(<JffCytoscapeViewer src="/x.jff" />);
    const asDrawn = screen.getByRole('radio', { name: 'As drawn' });
    const auto = screen.getByRole('radio', { name: 'Auto-arranged' });

    expect(auto).toBeChecked();
    expect(asDrawn).not.toBeChecked();

    fireEvent.click(asDrawn);
    expect(asDrawn).toBeChecked();
    expect(auto).not.toBeChecked();
  });

  it('honors honorPositionsDefault for the initial selection', () => {
    render(<JffCytoscapeViewer src="/x.jff" honorPositionsDefault />);
    expect(screen.getByRole('radio', { name: 'As drawn' })).toBeChecked();
  });

  it('does not flip the layout when the selected option is chosen again', () => {
    render(<JffCytoscapeViewer src="/x.jff" honorPositionsDefault />);
    const asDrawn = screen.getByRole('radio', { name: 'As drawn' });
    fireEvent.click(asDrawn);
    expect(asDrawn).toBeChecked();
  });
});

describe('JffCytoscapeViewer — engine controls', () => {
  it('animates a zoom-in relative to the current zoom', async () => {
    render(<JffCytoscapeViewer src="/x.jff" />);
    await waitForEngine();
    h.cy.animate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(h.cy.animate).toHaveBeenCalledTimes(1);
    // zoom() is 1 in the mock → target 1.2, clamped within [0.2, 6].
    expect(h.cy.animate.mock.calls[0][0]).toMatchObject({ zoom: 1.2 });
  });

  it('animates a zoom-out relative to the current zoom', async () => {
    render(<JffCytoscapeViewer src="/x.jff" />);
    await waitForEngine();
    h.cy.animate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(h.cy.animate).toHaveBeenCalledTimes(1);
    expect(h.cy.animate.mock.calls[0][0].zoom).toBeCloseTo(1 / 1.2);
  });

  it('exports an SVG via the engine on Download SVG', async () => {
    render(<JffCytoscapeViewer src="/x.jff" title="My FA" />);
    await waitForEngine();
    fireEvent.click(screen.getByRole('button', { name: 'Download SVG' }));
    await waitFor(() => expect(h.cy.svg).toHaveBeenCalled());
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('exports a PNG via the engine on Download PNG', async () => {
    render(<JffCytoscapeViewer src="/x.jff" />);
    await waitForEngine();
    fireEvent.click(screen.getByRole('button', { name: 'Download PNG' }));
    await waitFor(() => expect(h.cy.png).toHaveBeenCalled());
  });

  it('falls back to a PNG download when the clipboard is unavailable on Copy PNG', async () => {
    render(<JffCytoscapeViewer src="/x.jff" />);
    await waitForEngine();
    fireEvent.click(screen.getByRole('button', { name: 'Copy PNG to clipboard' }));
    // jsdom has no ClipboardItem → copyPNG falls back to downloadPNG (png()).
    await waitFor(() => expect(h.cy.png).toHaveBeenCalled());
  });
});

describe('JffViewerDialog — wrapper', () => {
  it('does not mount the viewer when closed', () => {
    render(<JffViewerDialog open={false} onOpenChange={() => {}} src="/x.jff" title="My FA" />);
    expect(screen.queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument();
  });

  it('mounts the viewer and shows the title when open', async () => {
    render(<JffViewerDialog open onOpenChange={() => {}} src="/x.jff" title="My FA" />);
    expect(screen.getByText('My FA')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
  });

  it('falls back to a default title', () => {
    render(<JffViewerDialog open onOpenChange={() => {}} src="/x.jff" />);
    expect(screen.getByText('JFLAP Viewer')).toBeInTheDocument();
  });
});

describe('the graph canvas says it can be dragged', () => {
  it('is an ordinary pointer at rest and a closed hand while dragging', () => {
    // jsdom cannot show a cursor, which is the point of asserting the classes: this is the
    // wiring, and how it looks is a browser check. The open hand is deliberately absent: it
    // would claim the whole canvas is a handle, over a diagram whose states are what a reader
    // is actually pointing at.
    render(<JffCytoscapeViewer src="/api/files/submissions/abc.jff" title="abc.jff" />);
    const canvas = screen.getByRole('img');
    expect(canvas.className).toContain('cursor-default');
    expect(canvas.className).toContain('active:cursor-grabbing');
    expect(canvas.className).not.toContain('cursor-grab ');
  });
});

describe('the toolbar does not repeat what a menu already offers', () => {
  const SRC = '/api/files/submissions/abc.jff';

  it('keeps Grid and Layout in a dialog, where the toolbar is the only place they exist', () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    expect(screen.getByRole('button', { name: /toggle grid/i })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Layout' })).toBeInTheDocument();
  });

  it('drops them in the standalone window, where the menu bar has them', () => {
    // Presence of the provider IS the signal, so the two can never disagree about which
    // surface owns these controls.
    render(
      <ViewerActionsProvider>
        <JffCytoscapeViewer src={SRC} title="abc.jff" />
      </ViewerActionsProvider>,
    );
    expect(screen.queryByRole('button', { name: /toggle grid/i })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Layout' })).toBeNull();
  });

  it('drops the export buttons in the standalone window too', () => {
    render(
      <ViewerActionsProvider>
        <JffCytoscapeViewer src={SRC} title="abc.jff" />
      </ViewerActionsProvider>,
    );
    expect(screen.queryByRole('group', { name: 'Export controls' })).toBeNull();
    expect(screen.queryByRole('button', { name: /copy png/i })).toBeNull();
  });

  it('keeps the export buttons in a dialog, which has no menu bar', () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    expect(screen.getByRole('group', { name: 'Export controls' })).toBeInTheDocument();
  });

  it('keeps zoom in both, since the menu has no zoom', () => {
    // The dividing line is duplication, not tidiness: zoom exists only on the toolbar, so it
    // stays in both places.
    render(
      <ViewerActionsProvider>
        <JffCytoscapeViewer src={SRC} title="abc.jff" />
      </ViewerActionsProvider>,
    );
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Zoom level' })).toBeInTheDocument();
  });
});

describe('the zoom slider', () => {
  const SRC = '/api/files/submissions/abc.jff';

  it('reads as one group: out, value, slider, in', () => {
    // The order is the request. Asserted by document position rather than by walking the DOM,
    // because the slider is built from several nested spans and any structural query would
    // break the next time that component changes.
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    const group = screen.getByRole('group', { name: 'Zoom' });
    const out = screen.getByRole('button', { name: 'Zoom out' });
    const value = screen.getByText('100%');
    const slider = screen.getByRole('slider', { name: 'Zoom level' });
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });

    for (const el of [out, value, slider, zoomIn]) expect(group).toContainElement(el);

    const precedes = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(precedes(out, value)).toBe(true);
    expect(precedes(value, slider)).toBe(true);
    expect(precedes(slider, zoomIn)).toBe(true);
  });

  it('shows the current zoom as a percentage', () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    expect(screen.getByRole('group', { name: 'Zoom' })).toHaveTextContent('100%');
  });

  it('keeps the value a fixed width, so the toolbar does not jump as zoom changes', () => {
    // Tabular numerals plus a set width. 50% and 200% must not move the buttons beside them.
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    const value = screen.getByText('100%');
    expect(value.className).toContain('tabular-nums');
    expect(value.className).toMatch(/\bw-\d+\b/);
  });

  it('offers Fit outside the zoom group, with a name that says what it does', () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    const fitButton = screen.getByRole('button', { name: 'Fit automaton to view' });
    expect(fitButton).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Zoom' })).not.toContainElement(fitButton);
  });

  it('announces its value as a spoken percentage, not a track position', () => {
    // A bare value announces "62", which is where the thumb sits and means nothing. Percent
    // is spelled out because how a screen reader pronounces the symbol varies.
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    const slider = screen.getByRole('slider', { name: 'Zoom level' });
    expect(slider).toHaveAttribute('aria-valuetext', '100 percent');
  });
});

describe('what the viewer publishes to a menu', () => {
  it('wires Fit to window to the real fit, not to a stub', async () => {
    // The menu's own test can only prove the menu calls whatever was registered. This is the
    // other half: that the viewer registers something that actually fits the graph. Wiring it
    // to a no-op would satisfy the menu test and do nothing in the window.
    let run: ((name: 'fitToWindow') => void) | null = null;
    function Probe() {
      run = useViewerActions().run;
      return null;
    }
    render(
      <ViewerActionsProvider>
        <JffCytoscapeViewer src="/api/files/submissions/abc.jff" title="abc.jff" />
        <Probe />
      </ViewerActionsProvider>,
    );

    // `fit` is only wired once the engine has loaded, so calling it before that would pass
    // for the wrong reason: a no-op is indistinguishable from a stub.
    await waitForEngine();
    // Loading the graph resizes it too, so start counting from here.
    h.cy.resize.mockClear();
    act(() => run?.('fitToWindow'));
    expect(h.cy.resize).toHaveBeenCalled();
  });
});

describe('the grid background renders the same on the server and in the browser', () => {
  it('uses the CSS variable with a literal fallback, not a computed colour', () => {
    // The viewer used to read --grid-color off the document at module scope behind a
    // `typeof window` check, so a server-rendered page produced one colour and hydration
    // produced another. Any literal here is fine; a computed one is not.
    render(<JffCytoscapeViewer src="/api/files/submissions/abc.jff" title="abc.jff" showGridDefault />);
    const style = screen.getByRole('img').getAttribute('style') ?? '';
    expect(style).toContain('var(--grid-color, #0f172a)');
    // A resolved colour function is what the mismatch looked like on the client side.
    expect(style).not.toContain('lab(');
    expect(style).not.toContain('oklch(');
  });

  it('reads no computed style while rendering', () => {
    // Deliberately a source check. jsdom resolves --grid-color to an empty string, so the
    // computed-style version falls back to the same literal and renders identically here:
    // the runtime assertion above cannot tell the two apart, and passed throughout the bug.
    // What can be checked is the practice, which is what actually caused it. A computed read
    // inside an effect or a handler would be fine; this file should have neither.
    const source = readFileSync(path.join(__dirname, 'JffViewerDialog.tsx'), 'utf8');
    expect(source).not.toContain('getComputedStyle');
  });
});

describe('where the text description lives', () => {
  const SRC = '/api/files/submissions/abc.jff';

  it('keeps the panel and its toggle in a dialog', async () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    await waitForEngine();
    expect(screen.getByRole('button', { name: /show text representation/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Description of this file' })).toBeInTheDocument();
  });

  it('takes the panel off the screen in the standalone window', async () => {
    render(
      <ViewerActionsProvider>
        <JffCytoscapeViewer src={SRC} title="abc.jff" />
      </ViewerActionsProvider>,
    );
    await waitForEngine();
    expect(screen.queryByRole('button', { name: /show text representation/i })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Description of this file' })).toBeNull();
  });

  it('still gives the canvas its text alternative, which is not optional', async () => {
    // The panel is hidden, not removed: aria-describedby points at the summary, and a canvas
    // with nothing behind that attribute is unreadable to a screen reader. Removing the panel
    // outright would have been a silent accessibility regression.
    render(
      <ViewerActionsProvider>
        <JffCytoscapeViewer src={SRC} title="abc.jff" />
      </ViewerActionsProvider>,
    );
    await waitForEngine();
    const canvas = screen.getByRole('img');
    const describedBy = canvas.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const summary = document.getElementById(describedBy as string);
    expect(summary?.textContent).toMatch(/finite automaton/i);
  });

  it('publishes an action that opens it, and renders the listing to open', async () => {
    // What this cannot check: whether the dialog is shut to begin with. The shared ui/dialog
    // mock this file uses renders its children whatever `open` says and gives them no dialog
    // role, so open and closed look identical here. The wiring is covered; the opening itself
    // is a browser check.
    let run: ((name: 'showTextRepresentation') => void) | null = null;
    function Probe() {
      run = useViewerActions().run;
      return null;
    }
    render(
      <ViewerActionsProvider>
        <JffCytoscapeViewer src={SRC} title="abc.jff" />
        <Probe />
      </ViewerActionsProvider>,
    );
    await waitForEngine();

    expect(run).not.toBeNull();
    act(() => run?.('showTextRepresentation'));

    // The listing is present to be shown, with the same content the dialog panel carries.
    expect(screen.getByText('Text representation')).toBeInTheDocument();
    expect(screen.getByText('Initial state')).toBeInTheDocument();
  });
});

describe('the JFLAP notes toggle', () => {
  const SRC = '/api/files/submissions/abc.jff';

  it('draws notes by default, and hides them as a style change rather than a rebuild', async () => {
    // A rebuild would re-run the layout and move the machine under the reader, which is not
    // what asking to hide a note should do.
    let run: ((name: 'toggleNotes') => void) | null = null;
    function Probe() {
      run = useViewerActions().run;
      return null;
    }
    render(
      <ViewerActionsProvider>
        <JffCytoscapeViewer src={SRC} title="abc.jff" />
        <Probe />
      </ViewerActionsProvider>,
    );
    await waitForEngine();

    const style = vi.fn();
    h.cy.$.mockReturnValue({ style });
    act(() => run?.('toggleNotes'));

    expect(h.cy.$).toHaveBeenCalledWith('node.note');
    expect(style).toHaveBeenCalledWith('display', 'none');
    // The graph itself was not rebuilt.
    expect(h.ctor).toHaveBeenCalledTimes(1);
  });
});

describe('the start marker', () => {
  const startStyle = () => {
    // The ctor mock is untyped, so its recorded arguments come back as an empty tuple.
    const firstCall = h.ctor.mock.calls[0] as unknown as [
      { style?: { selector: string; style: Record<string, unknown> }[] },
    ];
    const style = firstCall?.[0]?.style;
    return style?.find((rule) => rule.selector === 'node.start')?.style;
  };

  it('is filled rather than see-through, so the grid does not show inside it', async () => {
    // Unfilled, the grid lines and any edge passing behind it ran straight through the
    // triangle, which made it read as an outline sitting on the canvas rather than as part
    // of the machine.
    render(<JffCytoscapeViewer src="/api/files/submissions/abc.jff" title="abc.jff" darkMode={false} />);
    await waitForEngine();
    expect(startStyle()?.['background-opacity']).toBe(1);
    expect(startStyle()?.['background-color']).toBe('#ffffff');
  });

  it('takes the dark canvas colour in dark mode, not white', async () => {
    render(<JffCytoscapeViewer src="/api/files/submissions/abc.jff" title="abc.jff" darkMode />);
    await waitForEngine();
    expect(startStyle()?.['background-color']).not.toBe('#ffffff');
  });
});

describe('clicking a state', () => {
  const SRC = '/api/files/submissions/abc.jff';

  /** Fire the tap handler cytoscape would have called, with a node-shaped target. */
  const tapNode = (id: string) => {
    const tap = h.cy.on.mock.calls.find(([name]) => name === 'tap')?.[1] as
      | ((evt: { target: unknown }) => void)
      | undefined;
    const node = {
      isNode: () => true,
      hasClass: () => false,
      id: () => id,
      closedNeighborhood: () => ({ addClass: () => ({ removeClass: () => undefined }) }),
    };
    act(() => tap?.({ target: node }));
  };

  const tapBackground = () => {
    const tap = h.cy.on.mock.calls.find(([name]) => name === 'tap')?.[1] as
      | ((evt: { target: unknown }) => void)
      | undefined;
    act(() => tap?.({ target: h.cy }));
  };

  it('shows nothing until something is clicked', async () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    await waitForEngine();
    expect(screen.queryByRole('group', { name: /properties of state/i })).toBeNull();
  });

  it('names the state and lists what leaves and arrives', async () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    await waitForEngine();
    tapNode('0');
    const panel = await screen.findByRole('group', { name: /properties of state/i });
    expect(panel).toHaveTextContent('Out');
    expect(panel).toHaveTextContent('In');
  });

  it('goes away when the canvas is clicked, which is how somebody dismisses it', async () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    await waitForEngine();
    tapNode('0');
    expect(await screen.findByRole('group', { name: /properties of state/i })).toBeInTheDocument();
    tapBackground();
    expect(screen.queryByRole('group', { name: /properties of state/i })).toBeNull();
  });

  it('closes from its own button too', async () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    await waitForEngine();
    tapNode('0');
    fireEvent.click(await screen.findByRole('button', { name: /close state properties/i }));
    expect(screen.queryByRole('group', { name: /properties of state/i })).toBeNull();
  });

  it('shows nothing for the start marker, which is scenery rather than a state', async () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    await waitForEngine();
    const tap = h.cy.on.mock.calls.find(([name]) => name === 'tap')?.[1] as
      | ((evt: { target: unknown }) => void)
      | undefined;
    act(() =>
      tap?.({
        target: {
          isNode: () => true,
          hasClass: (c: string) => c === 'start',
          id: () => 'start-0',
          closedNeighborhood: () => ({ addClass: () => ({ removeClass: () => undefined }) }),
        },
      }),
    );
    expect(screen.queryByRole('group', { name: /properties of state/i })).toBeNull();
  });
});

describe('clicking a transition', () => {
  const SRC = '/api/files/submissions/abc.jff';

  const tapEdge = (source: string, target: string) => {
    const tap = h.cy.on.mock.calls.find(([name]) => name === 'tap')?.[1] as
      | ((evt: { target: unknown }) => void)
      | undefined;
    const edge = {
      isNode: () => false,
      hasClass: () => false,
      id: () => `e0-${source}-${target}`,
      data: (key: string) => (key === 'source' ? source : target),
      closedNeighborhood: () => ({ addClass: () => ({ removeClass: () => undefined }) }),
    };
    act(() => tap?.({ target: edge }));
  };

  const tapNode = (id: string) => {
    const tap = h.cy.on.mock.calls.find(([name]) => name === 'tap')?.[1] as
      | ((evt: { target: unknown }) => void)
      | undefined;
    act(() =>
      tap?.({
        target: {
          isNode: () => true,
          hasClass: () => false,
          id: () => id,
          closedNeighborhood: () => ({ addClass: () => ({ removeClass: () => undefined }) }),
        },
      }),
    );
  };

  it('names both ends and lists what the transition reads', async () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    await waitForEngine();
    tapEdge('0', '1');
    const panel = await screen.findByRole('group', { name: /transition from/i });
    expect(panel).toHaveTextContent('Reads');
  });

  it('shows one panel at a time, not a state and a transition together', async () => {
    // Both are driven by the same click, so the previous one has to give way rather than the
    // two stacking in the same corner.
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    await waitForEngine();
    tapNode('0');
    expect(await screen.findByRole('group', { name: /properties of state/i })).toBeInTheDocument();
    tapEdge('0', '1');
    expect(await screen.findByRole('group', { name: /transition from/i })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /properties of state/i })).toBeNull();
  });

  it('goes away on a background click, like the state panel', async () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    await waitForEngine();
    tapEdge('0', '1');
    expect(await screen.findByRole('group', { name: /transition from/i })).toBeInTheDocument();
    const tap = h.cy.on.mock.calls.find(([name]) => name === 'tap')?.[1] as
      | ((evt: { target: unknown }) => void)
      | undefined;
    act(() => tap?.({ target: h.cy }));
    expect(screen.queryByRole('group', { name: /transition from/i })).toBeNull();
  });

  it('shows nothing for an edge the machine does not have', async () => {
    // describeEdge returns null rather than an empty panel, so a stale or bundled id that no
    // longer matches produces no window at all.
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    await waitForEngine();
    tapEdge('nope', 'also-nope');
    expect(screen.queryByRole('group', { name: /transition from/i })).toBeNull();
  });
});

describe('copying the text representation', () => {
  it('offers the copy beside the text, in the standalone window', async () => {
    render(
      <ViewerActionsProvider>
        <JffCytoscapeViewer src="/api/files/submissions/abc.jff" title="abc.jff" />
      </ViewerActionsProvider>,
    );
    await waitForEngine();
    // The dialog mock renders its children regardless of `open`, so this proves the button is
    // there to be shown rather than that the dialog is open. See the note on that mock above.
    expect(screen.getByRole('button', { name: /copy as text/i })).toBeInTheDocument();
  });
});

describe('what the viewer opens at', () => {
  const SRC = '/api/files/submissions/abc.jff';

  it('fits to the space by default, which is what a dialog wants', async () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    await waitForEngine();
    await waitFor(() => expect(h.cy.resize).toHaveBeenCalled());
    // Fit leaves the scale wherever it lands; nothing forces it back to 1.
    expect(h.cy.zoom).not.toHaveBeenCalledWith(1);
  });

  it('opens at 100% when asked, so the machine is the size its author drew it', async () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" initialZoom="actual" />);
    await waitForEngine();
    // Still fits first: that sizes the canvas and centres the machine, which is what keeps it
    // in view at 1:1 rather than off in a corner.
    await waitFor(() => expect(h.cy.zoom).toHaveBeenCalledWith(1));
    expect(h.cy.resize).toHaveBeenCalled();
    expect(h.cy.center).toHaveBeenCalled();
  });
});

describe('undo and redo of the arrangement', () => {
  const SRC = '/api/files/submissions/abc.jff';

  /** A node the history code can read a position from and write one back to. */
  const fakeNode = (id: string, pos: { x: number; y: number }) => ({
    id: () => id,
    hasClass: () => false,
    empty: () => false,
    position: vi.fn((next?: { x: number; y: number }) => {
      if (next) Object.assign(pos, next);
      return pos;
    }),
  });

  const fire = (event: string) => {
    const handler = h.cy.on.mock.calls.find(([name]) => name === event)?.[2] as
      | (() => void)
      | undefined;
    act(() => handler?.());
  };

  it('records a step when a state is picked up, not on every pixel of the drag', async () => {
    // One drag is one undoable step. `grab` fires once, at the start; `position` fires
    // continuously, and recording there would bury the previous state under hundreds of
    // near-identical snapshots.
    const pos = { x: 10, y: 20 };
    const node = fakeNode('0', pos);
    h.cy.nodes.mockReturnValue({ forEach: (fn: (n: unknown) => void) => fn(node), length: 1 });

    const view: { current: { canUndo: boolean; run: (n: 'undo') => void } | null } = {
      current: null,
    };
    function Probe() {
      const v = useViewerActions();
      view.current = { canUndo: v.canUndo, run: v.run };
      return null;
    }
    render(
      <ViewerActionsProvider>
        <JffCytoscapeViewer src={SRC} title="abc.jff" />
        <Probe />
      </ViewerActionsProvider>,
    );
    await waitForEngine();

    expect(view.current?.canUndo).toBe(false);
    fire('grab');
    await waitFor(() => expect(view.current?.canUndo).toBe(true));
  });

  it('puts the positions back when undone', async () => {
    const pos = { x: 10, y: 20 };
    const node = fakeNode('0', pos);
    h.cy.nodes.mockReturnValue({ forEach: (fn: (n: unknown) => void) => fn(node), length: 1 });
    h.cy.getElementById.mockReturnValue(node);

    const view: { current: { canUndo: boolean; run: (n: 'undo') => void } | null } = {
      current: null,
    };
    function Probe() {
      const v = useViewerActions();
      view.current = { canUndo: v.canUndo, run: v.run };
      return null;
    }
    render(
      <ViewerActionsProvider>
        <JffCytoscapeViewer src={SRC} title="abc.jff" />
        <Probe />
      </ViewerActionsProvider>,
    );
    await waitForEngine();

    fire('grab');
    await waitFor(() => expect(view.current?.canUndo).toBe(true));

    // The drag itself: the state ends up somewhere else.
    pos.x = 500;
    pos.y = 600;

    act(() => view.current?.run('undo'));
    await waitFor(() => expect(pos).toEqual({ x: 10, y: 20 }));
  });
});

describe('the toolbar undo and redo buttons', () => {
  const SRC = '/api/files/submissions/abc.jff';

  it('are disabled until there is something to step through', async () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    await waitForEngine();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  it('sit before the zoom group, where a toolbar puts them', async () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    await waitForEngine();
    const undoButton = screen.getByRole('button', { name: 'Undo' });
    const zoomGroup = screen.getByRole('group', { name: 'Zoom' });
    const precedes = Boolean(
      undoButton.compareDocumentPosition(zoomGroup) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(precedes).toBe(true);
  });

  it('drive the same history the menu does', async () => {
    const pos = { x: 10, y: 20 };
    const node = {
      id: () => '0',
      hasClass: () => false,
      empty: () => false,
      position: vi.fn((next?: { x: number; y: number }) => {
        if (next) Object.assign(pos, next);
        return pos;
      }),
    };
    h.cy.nodes.mockReturnValue({ forEach: (fn: (n: unknown) => void) => fn(node), length: 1 });
    h.cy.getElementById.mockReturnValue(node);

    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    await waitForEngine();

    const grab = h.cy.on.mock.calls.find(([name]) => name === 'grab')?.[2] as
      | (() => void)
      | undefined;
    act(() => grab?.());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled());

    pos.x = 500;
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(pos.x).toBe(10));
  });
});

describe('the machine does not flash on the way in', () => {
  const SRC = '/api/files/submissions/abc.jff';

  it('is hidden while the first layout is still settling', () => {
    // Cytoscape paints as soon as it is built, before anything has been fitted or scaled, so
    // the machine used to arrive at the wrong size and jump. Rendered but not shown.
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    expect(screen.getByRole('img').className).toContain('[&_canvas]:opacity-0');
  });

  it('appears once it has settled', async () => {
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    await waitFor(() => expect(screen.getByRole('img').className).toContain('[&_canvas]:opacity-100'));
  });

  it('hides again when a second file is loaded into the same viewer', async () => {
    // The one that was still flashing. React re-runs effects in development, and the source
    // can change in place, so a load that began with the graph already visible painted the
    // new machine un-fitted for a moment. Every load starts hidden.
    const { rerender } = render(<JffCytoscapeViewer src={SRC} title="abc.jff" />);
    await waitFor(() => expect(screen.getByRole('img').className).toContain('[&_canvas]:opacity-100'));

    rerender(<JffCytoscapeViewer src="/api/files/submissions/other.jff" title="other.jff" />);
    await waitFor(() => expect(screen.getByRole('img').className).toContain('opacity-0'));
    await waitFor(() => expect(screen.getByRole('img').className).toContain('[&_canvas]:opacity-100'));
  });

  it('appears even if setting the initial scale throws', async () => {
    // What the `finally` actually protects. `fitAndResize` swallows its own errors, so a
    // failing layout never reaches here; the step after it can still throw, and an invisible
    // graph with no explanation is worse than one at the wrong zoom.
    h.cy.center.mockImplementationOnce(() => {
      throw new Error('center exploded');
    });
    render(<JffCytoscapeViewer src={SRC} title="abc.jff" initialZoom="actual" />);
    await waitFor(() => expect(screen.getByRole('img').className).toContain('[&_canvas]:opacity-100'));
  });
});
