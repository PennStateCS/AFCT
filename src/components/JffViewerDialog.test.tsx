/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import JffViewerDialog, { JffCytoscapeViewer } from './JffViewerDialog';

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
    add: vi.fn(() => chain),
    on: vi.fn(),
    layout: vi.fn(() => ({ run: vi.fn(), on: vi.fn() })),
    width: vi.fn(() => 800),
    height: vi.fn(() => 600),
    zoom: vi.fn(() => 1),
    minZoom: vi.fn(() => 0.2),
    maxZoom: vi.fn(() => 6),
    center: vi.fn(() => ({ x: 0, y: 0 })),
    animate: vi.fn(),
    svg: vi.fn(() => '<svg></svg>'),
    png: vi.fn(() => 'data:image/png;base64,AAAA'),
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

// Keep the Dialog wrapper light (no Radix portal / a11y noise) — it renders children.
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

// Resolves once load() has instantiated the (mocked) cytoscape engine — i.e. cyRef
// is set and the toolbar handlers can drive it.
const waitForEngine = () => waitFor(() => expect(h.ctor).toHaveBeenCalled());

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
      'Original positions',
      'Zoom out',
      'Zoom in',
      'Fit to view',
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

  it('toggles the original-positions pressed-state on click', async () => {
    render(<JffCytoscapeViewer src="/x.jff" />);
    const btn = screen.getByRole('button', { name: 'Original positions' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
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
