/** @vitest-environment jsdom */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The JFLAP viewer's cytoscape engine.
 *
 * The geometry this hook decides with lives in `lib/jflap-layout` and is already covered
 * there; the parsing lives in `lib/jflap-parse` and likewise. What was untested is the part
 * in between: taking a parsed machine, driving cytoscape with it, and placing the things
 * JFLAP draws that cytoscape has no concept of - the initial-state marker, the self-loop
 * arcs, and the standoff that keeps a transition label off its own line.
 *
 * Cytoscape is replaced with a fake rather than run for real. That is not a shortcut here:
 * a real engine would need a canvas and a layout pass, and its node positions would then be
 * whatever the layout chose, so the geometry assertions below could not say anything exact.
 * Driving it with fixed positions is what makes "the marker went to the far side" checkable.
 * What the fake cannot tell you is whether the picture looks right, which is a browser job.
 */

/* ────────────────────────── a minimal fake cytoscape ────────────────────────── */

type Pos = { x: number; y: number };

class FakeEl {
  data_: Record<string, unknown>;
  pos: Pos;
  classes: Set<string>;
  style_: Record<string, unknown> = {};
  cy!: FakeCy;

  constructor(data: Record<string, unknown>, pos: Pos, classes = '') {
    this.data_ = { ...data };
    this.pos = { ...pos };
    this.classes = new Set(classes.split(' ').filter(Boolean));
  }

  id() {
    return String(this.data_.id);
  }
  data(key?: string, value?: unknown) {
    if (key === undefined) return this.data_;
    if (value !== undefined) {
      this.data_[key] = value;
      return this;
    }
    return this.data_[key];
  }
  position(): Pos;
  position(next: Pos): this;
  position(next?: Pos): Pos | this {
    if (next) {
      this.pos = { ...next };
      return this;
    }
    return this.pos;
  }
  style(obj?: Record<string, unknown>) {
    if (obj) Object.assign(this.style_, obj);
    return this.style_;
  }
  hasClass(c: string) {
    return this.classes.has(c);
  }
  addClass(c: string) {
    c.split(' ').forEach((x) => this.classes.add(x));
    return this;
  }
  removeClass(c: string) {
    c.split(' ').forEach((x) => this.classes.delete(x));
    return this;
  }
  isNode() {
    return this.data_.source === undefined;
  }
  /** The element plus whatever touches it, which is what tap highlights. */
  closedNeighborhood() {
    const touching = this.isNode()
      ? this.connectedEdges()
      : [this.source(), this.target()].filter(Boolean);
    return collection([this as FakeEl, ...(touching as FakeEl[])]);
  }
  empty() {
    return false;
  }
  source() {
    return this.cy.byId(String(this.data_.source)) as FakeEl;
  }
  target() {
    return this.cy.byId(String(this.data_.target)) as FakeEl;
  }
  /** Cytoscape's real midpoint; enough for the label-offset maths under test. */
  midpoint() {
    const a = this.source().position();
    const b = this.target().position();
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  connectedEdges() {
    return this.cy.edgeList.filter(
      (e) => e.data_.source === this.id() || e.data_.target === this.id(),
    );
  }
}

type Collection = FakeEl[] & {
  addClass: (c: string) => Collection;
  removeClass: (c: string) => Collection;
};

/** Cytoscape collections carry class methods; plain arrays do not. */
function collection(els: FakeEl[]): Collection {
  const arr = [...els] as Collection;
  arr.addClass = (c) => {
    els.forEach((e) => e.addClass(c));
    return arr;
  };
  arr.removeClass = (c) => {
    els.forEach((e) => e.removeClass(c));
    return arr;
  };
  return arr;
}

/** An absent element: cytoscape answers with an empty collection, not null. */
const MISSING = { empty: () => true, position: () => ({ x: 0, y: 0 }), style: () => ({}) };

class FakeCy {
  nodeList: FakeEl[] = [];
  edgeList: FakeEl[] = [];
  destroyed = false;
  fitCalls = 0;
  layoutNames: string[] = [];
  handlers: Record<string, (evt: unknown) => void> = {};
  /**
   * The element definitions exactly as they were handed to cytoscape.
   *
   * `nodeList` below keeps only what a fake element models. Some things are properties of the
   * definition rather than of the element, `selectable` and `grabbable` among them, and those
   * are the ones that say a note is not part of the machine.
   */
  rawElements: Array<Record<string, unknown>> = [];
  /** The stylesheet as handed to cytoscape, so a rule can be asserted by its selector. */
  styleSheet: Array<{ selector: string; style: Record<string, unknown> }> = [];

  constructor(config: {
    elements?: Array<Record<string, unknown>>;
    style?: Array<{ selector: string; style: Record<string, unknown> }>;
  }) {
    this.rawElements = config.elements ?? [];
    this.styleSheet = config.style ?? [];
    for (const el of config.elements ?? []) {
      const data = el.data as Record<string, unknown>;
      const made = new FakeEl(
        data,
        (el.position as Pos) ?? { x: 0, y: 0 },
        (el.classes as string) ?? '',
      );
      made.cy = this;
      if (data.source !== undefined) this.edgeList.push(made);
      else this.nodeList.push(made);
    }
  }

  /** The style block for one selector, exactly as the viewer declared it. */
  styleFor(selector: string) {
    return this.styleSheet.find((rule) => rule.selector === selector)?.style;
  }

  byId(id: string) {
    return [...this.nodeList, ...this.edgeList].find((e) => e.id() === id);
  }

  nodes() {
    return this.nodeList;
  }
  /** Only the one selector the hook uses. */
  edges(selector?: string) {
    if (selector === '[isLoop = 1]') return this.edgeList.filter((e) => e.data_.isLoop === 1);
    return this.edgeList;
  }
  elements() {
    return collection([...this.nodeList, ...this.edgeList]);
  }
  getElementById(id: string) {
    return this.byId(id) ?? MISSING;
  }
  add(spec: { data: Record<string, unknown>; position: Pos; classes?: string }) {
    const made = new FakeEl(spec.data, spec.position, spec.classes ?? '');
    made.cy = this;
    this.nodeList.push(made);
    return made;
  }
  layout(opts: { name: string }) {
    this.layoutNames.push(opts.name);
    return {
      run: () => {},
      on: (_evt: string, cb: () => void) => cb(),
    };
  }
  /**
   * Cytoscape takes either `(event, handler)` or `(event, selector, handler)`, and the viewer
   * uses both. Storing the second argument regardless left the selector string under the
   * event name, so a test that fired `grab` was calling a string.
   */
  on(evt: string, a: unknown, b?: (e: unknown) => void) {
    this.handlers[evt] = (typeof a === 'function' ? a : b) as (e: unknown) => void;
  }
  fit() {
    this.fitCalls += 1;
  }
  destroy() {
    this.destroyed = true;
  }
  resize() {}
  center() {}
  animations: Array<{ zoom: number }> = [];
  animate(opts: { zoom: number }) {
    this.animations.push(opts);
  }
  zoomLevel = 1;
  /** A getter and a setter on one name, as cytoscape's is. */
  zoom(next?: number) {
    if (typeof next === 'number') this.zoomLevel = next;
    return this.zoomLevel;
  }
  minZoom() {
    return 0.2;
  }
  maxZoom() {
    return 6;
  }
  // Read by the grid sync, which keeps the painted lines in step with the graph. Without it
  // that sync threw on every load, and only its own try/catch kept the viewer working: the
  // feature was silently absent here rather than tested.
  panPosition: Pos = { x: 0, y: 0 };
  pan(next?: Pos) {
    if (next) this.panPosition = { ...next };
    return this.panPosition;
  }
  panningEnabled() {}
  userPanningEnabled() {}
  userZoomingEnabled() {}
  svg() {
    return '<svg/>';
  }
  png() {
    return 'data:image/png;base64,AAA';
  }
}

const instances: FakeCy[] = [];
const cytoscapeMock = vi.hoisted(() => {
  // The module default is callable *and* carries `use`, which the hook calls once to
  // register the elk and svg extensions.
  const fn = vi.fn() as ReturnType<typeof vi.fn> & { use: ReturnType<typeof vi.fn> };
  fn.use = vi.fn();
  return { fn };
});

vi.mock('cytoscape', () => ({ default: cytoscapeMock.fn }));
vi.mock('cytoscape-elk', () => ({ default: () => {} }));
vi.mock('cytoscape-svg', () => ({ default: () => {} }));

import { useJffCytoscape, DEFAULT_EPS } from './useJffCytoscape';
import type { ViewerViewState } from '@/lib/viewer-view-state';

/* ─────────────────────────────── the fixture ─────────────────────────────── */

// q0 is initial, q1 is final and carries a self-loop. Two transitions run q0 -> q1, so
// there is a real edge to lay a label along and a loop to steer around.
const faXml = `
<structure>
  <type>fa</type>
  <automaton>
    <state id="0" name="q0"><x>10</x><y>20</y><initial/></state>
    <state id="1" name="q1"><x>100</x><y>20</y><final/></state>
    <transition><from>0</from><to>1</to><read>a</read></transition>
    <transition><from>1</from><to>1</to><read></read></transition>
  </automaton>
</structure>`;

function Harness(props: Parameters<typeof useJffCytoscape>[0] & { onApi?: (a: unknown) => void }) {
  const api = useJffCytoscape(props);
  props.onApi?.(api);
  return <div ref={api.containerRef} data-testid="canvas" />;
}

const renderViewer = (
  props: Partial<Parameters<typeof useJffCytoscape>[0]> = {},
): { api: () => ReturnType<typeof useJffCytoscape> } => {
  let latest: ReturnType<typeof useJffCytoscape>;
  render(
    <Harness
      src="/api/files/machine.jff"
      {...props}
      onApi={(a) => {
        latest = a as ReturnType<typeof useJffCytoscape>;
      }}
    />,
  );
  return { api: () => latest };
};

const lastCy = () => instances[instances.length - 1];
const fetchOk = (body: string) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK', text: async () => body });

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  instances.length = 0;
  cytoscapeMock.fn.mockImplementation((config: { elements?: Array<Record<string, unknown>> }) => {
    const cy = new FakeCy(config);
    instances.push(cy);
    return cy;
  });
  global.fetch = fetchOk(faXml) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

/* ──────────────────────────────── the tests ──────────────────────────────── */

describe('loading the machine', () => {
  it('reports the parsed machine type', async () => {
    const { api } = renderViewer();

    await waitFor(() => expect(api().type).toBe('fa'));
    expect(api().error).toBeNull();
    expect(api().parsed?.states).toHaveLength(2);
  });

  it('keeps the parsed machine, which is the only screen-reader-usable form of it', async () => {
    // The canvas says nothing to assistive tech, so the viewer renders a text description
    // from this. Losing it would make the dialog unreadable without sight.
    const { api } = renderViewer();

    await waitFor(() => expect(api().parsed).not.toBeNull());
    expect(api().parsed?.transitions).toHaveLength(2);
  });

  it('surfaces a failed fetch with its status, and builds no graph', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }) as unknown as typeof fetch;

    const { api } = renderViewer();

    await waitFor(() => expect(api().error).toMatch(/404/));
    expect(cytoscapeMock.fn).not.toHaveBeenCalled();
  });

  it('surfaces an unparseable file rather than rendering an empty canvas', async () => {
    global.fetch = fetchOk('<structure><oops') as unknown as typeof fetch;

    const { api } = renderViewer();

    await waitFor(() => expect(api().error).toMatch(/Invalid JFLAP/i));
    expect(cytoscapeMock.fn).not.toHaveBeenCalled();
  });

  it('uses the caller’s epsilon symbol on an empty transition', async () => {
    renderViewer({ epsSymbol: '@' });

    await waitFor(() => expect(lastCy()).toBeDefined());
    const loop = lastCy().edges('[isLoop = 1]')[0];
    expect(loop.data('label')).toBe('@');
  });

  it('defaults that symbol to ε', async () => {
    renderViewer();

    await waitFor(() => expect(lastCy()).toBeDefined());
    expect(lastCy().edges('[isLoop = 1]')[0].data('label')).toBe(DEFAULT_EPS);
  });
});

describe('the initial-state marker', () => {
  it('is added beside the initial state, and only for that state', async () => {
    renderViewer();

    await waitFor(() => expect(lastCy().getElementById('__start0').empty?.()).not.toBe(true));
    const marker = lastCy().byId('__start0') as FakeEl;
    const q0 = lastCy().byId('0') as FakeEl;

    expect(marker.hasClass('start')).toBe(true);
    // Beside it, not on top of it.
    expect(marker.position()).not.toEqual(q0.position());
    expect(lastCy().byId('__start1')).toBeUndefined();
  });

  it('carries an explicit empty label, which stops cytoscape warning about the mapping', async () => {
    renderViewer();

    await waitFor(() => expect(lastCy().byId('__start0')).toBeDefined());
    expect((lastCy().byId('__start0') as FakeEl).data('label')).toBe('');
  });

  it('is turned to point back at its state', async () => {
    renderViewer();

    await waitFor(() => expect(lastCy().byId('__start0')).toBeDefined());
    const marker = lastCy().byId('__start0') as FakeEl;

    expect(marker.style()['shape-polygon-points']).toEqual(expect.any(String));
  });

  it('is repositioned rather than duplicated when the layout is redone', async () => {
    // Toggling honorPositions re-runs placement against the same graph. A marker added
    // again each time would stack invisible triangles on the canvas.
    const { api } = renderViewer();
    await waitFor(() => expect(lastCy().byId('__start0')).toBeDefined());

    api().toggleHonorPositions();

    // Retry the count itself: the rebuilt graph places its marker asynchronously, and
    // asserting on a snapshot taken too early sees zero rather than a duplicate.
    await waitFor(() => {
      const markers = lastCy()
        .nodes()
        .filter((n) => n.id().startsWith('__start'));
      expect(markers).toHaveLength(1);
    });
  });
});

describe('self-loops', () => {
  it('records the direction it chose, so the marker can be steered clear of it', async () => {
    renderViewer();

    await waitFor(() => expect(lastCy()).toBeDefined());
    const loop = lastCy().edges('[isLoop = 1]')[0];

    await waitFor(() => expect(typeof loop.data('loopDirection')).toBe('number'));
  });

  it('is drawn as an arc, since cytoscape has no loop curve-style', async () => {
    renderViewer();

    await waitFor(() => expect(lastCy()).toBeDefined());
    const loop = lastCy().edges('[isLoop = 1]')[0];

    await waitFor(() => expect(loop.style()['curve-style']).toBe('bezier'));
    expect(loop.style()['loop-direction']).toMatch(/deg$/);
    // JFLAP points the arrowhead back into the state it left.
    expect(loop.style()['source-arrow-shape']).toBe('triangle');
    expect(loop.style()['target-arrow-shape']).toBe('none');
  });
});

describe('transition labels', () => {
  it('are lifted clear of their own line', async () => {
    // Without the standoff the text sits on the edge and neither is readable.
    renderViewer();

    await waitFor(() => expect(lastCy()).toBeDefined());
    const straight = lastCy()
      .edges()
      .find((e) => e.data('isLoop') !== 1) as FakeEl;

    await waitFor(() => expect(straight.style()['text-margin-x']).toEqual(expect.any(Number)));
    expect(straight.style()['text-margin-y']).toEqual(expect.any(Number));
  });

  it('leaves self-loop labels horizontal, as JFLAP draws them', async () => {
    // A straight edge rotates its label to follow the line. A loop has no direction to
    // follow, so it opts out and takes its offset from the loop geometry instead.
    renderViewer();

    await waitFor(() => expect(lastCy()).toBeDefined());
    const loop = lastCy().edges('[isLoop = 1]')[0];

    await waitFor(() => expect(loop.style()['curve-style']).toBe('bezier'));
    expect(loop.style()['text-rotation']).toBe('none');
    expect(loop.style()['text-margin-y']).toEqual(expect.any(Number));
  });
});

describe('rebuilding the graph', () => {
  it('destroys the previous engine rather than leaking it', async () => {
    const { api } = renderViewer();
    await waitFor(() => expect(instances).toHaveLength(1));
    const first = instances[0];

    api().toggleHonorPositions();

    await waitFor(() => expect(instances.length).toBeGreaterThan(1));
    expect(first.destroyed).toBe(true);
  });

  it('honours the file’s own coordinates with a preset layout when asked', async () => {
    renderViewer({ honorPositionsDefault: true });

    await waitFor(() => expect(lastCy().layoutNames).toContain('preset'));
  });

  it('lays the machine out itself when not asked', async () => {
    renderViewer({ honorPositionsDefault: false });

    await waitFor(() => expect(lastCy().layoutNames.length).toBeGreaterThan(0));
    expect(lastCy().layoutNames).not.toContain('preset');
  });

  /**
   * Notes only make sense where the saved coordinates are used. Auto-arranged, every state has
   * moved, so a note left where the student put it annotates whatever it lands on.
   */
  describe('notes written on the drawing', () => {
    const noteXml = `
<structure>
  <type>fa</type>
  <automaton>
    <state id="0" name="q0"><x>10</x><y>20</y><initial/></state>
    <note><text>check this loop</text><x>60</x><y>80</y></note>
  </automaton>
</structure>`;

    const noteElements = () =>
      lastCy().rawElements.filter((e) => e.classes === 'note') as Array<{
        data: { label: string };
        selectable?: boolean;
        grabbable?: boolean;
      }>;

    it('draws a note when the saved positions are used', async () => {
      global.fetch = fetchOk(noteXml) as unknown as typeof fetch;
      renderViewer({ honorPositionsDefault: true });

      await waitFor(() => expect(noteElements()).toHaveLength(1));
      expect(noteElements()[0].data.label).toBe('check this loop');
    });

    it('leaves it out when the machine is auto-arranged', async () => {
      global.fetch = fetchOk(noteXml) as unknown as typeof fetch;
      renderViewer({ honorPositionsDefault: false });

      await waitFor(() => expect(lastCy().rawElements.length).toBeGreaterThan(0));
      expect(noteElements()).toHaveLength(0);
    });

    /**
     * A note sits where the student dropped it and nothing moves aside for it, so it can land
     * on a state. When it does the machine has to stay readable, which means the note goes
     * behind it rather than over it.
     */
    it('is drawn behind the machine, so it cannot hide a state', async () => {
      global.fetch = fetchOk(noteXml) as unknown as typeof fetch;
      renderViewer({ honorPositionsDefault: true });

      await waitFor(() => expect(noteElements()).toHaveLength(1));
      const style = lastCy().styleFor('node.note');
      const stateStyle = lastCy().styleFor('node');
      expect(Number(style?.['z-index'])).toBeLessThan(Number(stateStyle?.['z-index']));
    });

    it('is not something the reader can select or drag', async () => {
      global.fetch = fetchOk(noteXml) as unknown as typeof fetch;
      renderViewer({ honorPositionsDefault: true });

      await waitFor(() => expect(noteElements()).toHaveLength(1));
      expect(noteElements()[0].selectable).toBe(false);
      expect(noteElements()[0].grabbable).toBe(false);
    });
  });

  it('fits the whole graph, labels included', async () => {
    renderViewer();

    await waitFor(() => expect(lastCy().fitCalls).toBeGreaterThan(0));
  });
});

describe('the export actions', () => {
  it('produce an SVG from the live graph', async () => {
    const { api } = renderViewer();
    await waitFor(() => expect(lastCy()).toBeDefined());

    const createUrl = vi.fn().mockReturnValue('blob:x');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await api().downloadSVG();

    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});

describe('interacting with the graph', () => {
  it('dims everything except the tapped state and what it touches', async () => {
    renderViewer();
    await waitFor(() => expect(lastCy().handlers.tap).toBeDefined());
    const cy = lastCy();
    const q0 = cy.byId('0') as FakeEl;

    cy.handlers.tap({ target: q0 });

    expect(q0.hasClass('highlighted')).toBe(true);
    expect(q0.hasClass('faded')).toBe(false);
    // The state it has no transition with stays dimmed.
    expect((cy.byId('1') as FakeEl).hasClass('faded')).toBe(true);
  });

  it('clears the dimming when the background is tapped', async () => {
    renderViewer();
    await waitFor(() => expect(lastCy().handlers.tap).toBeDefined());
    const cy = lastCy();
    cy.handlers.tap({ target: cy.byId('0') });

    cy.handlers.tap({ target: cy });

    expect(cy.elements().some((e) => e.hasClass('faded') || e.hasClass('highlighted'))).toBe(false);
  });

  it('re-runs the geometry when a state is dragged', async () => {
    renderViewer();
    await waitFor(() => expect(lastCy().handlers.position).toBeDefined());
    const cy = lastCy();
    const marker = cy.byId('__start0') as FakeEl;
    const before = { ...marker.position() };
    (cy.byId('0') as FakeEl).position({ x: 400, y: 400 });

    await cy.handlers.position({ target: cy.byId('0') });

    await waitFor(() => expect(marker.position()).not.toEqual(before));
  });

  it('ignores a move of the marker itself, which would otherwise recurse', async () => {
    // repositionStartNodes moves the marker, which fires `position` again. Without the
    // guard that is an endless loop.
    renderViewer();
    await waitFor(() => expect(lastCy().handlers.position).toBeDefined());
    const cy = lastCy();
    const marker = cy.byId('__start0') as FakeEl;
    marker.position({ x: 999, y: 999 });

    await cy.handlers.position({ target: marker });

    expect(marker.position()).toEqual({ x: 999, y: 999 });
  });
});

describe('zooming', () => {
  it('zooms in and out around the graph', async () => {
    const { api } = renderViewer();
    await waitFor(() => expect(lastCy()).toBeDefined());

    api().zoomIn();
    expect(lastCy().animations.at(-1)?.zoom).toBeCloseTo(1.2);

    api().zoomOut();
    expect(lastCy().animations.at(-1)?.zoom).toBeCloseTo(1 / 1.2);
  });

  it('will not zoom past the engine’s own limits', async () => {
    const { api } = renderViewer();
    await waitFor(() => expect(lastCy()).toBeDefined());
    lastCy().zoomLevel = 100;

    api().zoomIn();

    expect(lastCy().animations.at(-1)?.zoom).toBe(6);
  });
});

describe('remembering the view across a refresh', () => {
  const KEY = 'submissions:machine.jff';
  const STORAGE_KEY = `afct.viewer.view.${KEY}`;

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  const saved = () => {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ViewerViewState) : null;
  };

  it('writes the view down once the machine has settled', async () => {
    renderViewer({ viewStateKey: KEY });
    await waitFor(() => expect(saved()).not.toBeNull());
    // Both states, since the viewer opens on the drawn layout here.
    expect(Object.keys(saved()!.positions).sort()).toEqual(['0', '1']);
  });

  it('follows the reader as they zoom and pan', async () => {
    renderViewer({ viewStateKey: KEY });
    await waitFor(() => expect(saved()).not.toBeNull());

    const cy = lastCy();
    cy.zoom(2.5);
    cy.pan({ x: -30, y: 12 });
    // Cytoscape fires this for the wheel, the slider, Fit and a drag of the background alike.
    cy.handlers['viewport position']?.({});

    await waitFor(() => expect(saved()?.zoom).toBe(2.5));
    expect(saved()?.pan).toEqual({ x: -30, y: 12 });
  });

  it('saves the last movement before the page goes', async () => {
    // The writer is debounced, so without a flush on the way out a wheel or a drag in the
    // last fraction of a second before a refresh would be lost. Asserted synchronously on
    // purpose: the pending timer cannot have fired yet, so only the flush can have written.
    renderViewer({ viewStateKey: KEY });
    await waitFor(() => expect(saved()).not.toBeNull());

    lastCy().zoom(2.5);
    lastCy().handlers['viewport position']?.({});
    window.dispatchEvent(new Event('pagehide'));

    expect(saved()?.zoom).toBe(2.5);
  });

  it('opens the next time where the reader left it', async () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        zoom: 3,
        pan: { x: 42, y: -7 },
        // Keyed by the ids in the file, which is what the graph's nodes carry.
        positions: { '0': { x: 500, y: 500 }, '1': { x: 640, y: 500 } },
        honorPositions: true,
      }),
    );

    renderViewer({ viewStateKey: KEY });
    await waitFor(() => expect(lastCy().zoomLevel).toBe(3));
    expect(lastCy().panPosition).toEqual({ x: 42, y: -7 });
    expect(lastCy().byId('0')?.position()).toEqual({ x: 500, y: 500 });
  });

  it('does not put the old positions back when the layout is switched', async () => {
    // The regression this guards: the restore ran at the end of every load, and switching to
    // Auto-arranged is a load, so the layout engine placed the states and the remembered
    // positions were immediately dropped back on top. Auto-arranged looked broken.
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        zoom: 1,
        pan: { x: 0, y: 0 },
        positions: { '0': { x: 500, y: 500 }, '1': { x: 640, y: 500 } },
        honorPositions: true,
      }),
    );

    const { api } = renderViewer({ viewStateKey: KEY });
    await waitFor(() => expect(lastCy().byId('0')?.position()).toEqual({ x: 500, y: 500 }));

    act(() => api().toggleHonorPositions());
    await waitFor(() => expect(lastCy().layoutNames).toContain('elk'));
    expect(lastCy().byId('0')?.position()).not.toEqual({ x: 500, y: 500 });
  });

  it('ignores an arrangement belonging to a different machine', async () => {
    // Positions are keyed by state name, so another machine's would move whichever states
    // happened to share a name and leave the rest, which is worse than opening at the fit.
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        zoom: 3,
        pan: { x: 42, y: -7 },
        positions: { '0': { x: 500, y: 500 }, '7': { x: 900, y: 500 } },
        honorPositions: true,
      }),
    );

    const { api } = renderViewer({ viewStateKey: KEY });
    await waitFor(() => expect(api().type).toBe('fa'));
    await waitFor(() => expect(lastCy().fitCalls).toBeGreaterThan(0));
    expect(lastCy().zoomLevel).not.toBe(3);
    expect(lastCy().byId('0')?.position()).not.toEqual({ x: 500, y: 500 });
  });

  it('remembers nothing without a key, which is every viewer in a dialog', async () => {
    const { api } = renderViewer();
    await waitFor(() => expect(api().type).toBe('fa'));
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('putting a machine back the way it opened', () => {
  const KEY = 'submissions:machine.jff';
  const STORAGE_KEY = `afct.viewer.view.${KEY}`;

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('builds the machine again from the file', async () => {
    // With something remembered, because that is what reset has to overrule: without it the
    // rebuild would restore the arrangement the reader just asked to be rid of.
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        zoom: 2,
        pan: { x: 0, y: 0 },
        positions: { '0': { x: 700, y: 700 }, '1': { x: 800, y: 700 } },
        honorPositions: true,
      }),
    );
    const { api } = renderViewer({ viewStateKey: KEY, honorPositionsDefault: true });
    await waitFor(() => expect(instances).toHaveLength(1));
    await waitFor(() => expect(lastCy().byId('0')?.position()).toEqual({ x: 700, y: 700 }));

    act(() => api().resetMachine());

    await waitFor(() => expect(instances.length).toBeGreaterThan(1));
    // Where the file itself puts q0, taken from what was handed to the new engine rather
    // than from a number written here, which would only be the scale factor restated.
    const fromFile = lastCy().rawElements.find((el) => (el.data as { id?: string }).id === '0')
      ?.position as { x: number; y: number };
    expect(fromFile).not.toEqual({ x: 700, y: 700 });
    expect(lastCy().byId('0')?.position()).toEqual(fromFile);
  });

  it('goes back to the layout the viewer opens on', async () => {
    const { api } = renderViewer({ viewStateKey: KEY });
    await waitFor(() => expect(api().honorPositions).toBe(false));
    act(() => api().toggleHonorPositions());
    await waitFor(() => expect(api().honorPositions).toBe(true));

    act(() => api().resetMachine());
    await waitFor(() => expect(api().honorPositions).toBe(false));
  });

  it('forgets the remembered view, so a refresh does not bring it back', async () => {
    const { api } = renderViewer({ viewStateKey: KEY });
    await waitFor(() => expect(window.sessionStorage.getItem(STORAGE_KEY)).not.toBeNull());

    act(() => api().resetMachine());

    // Immediately, before the rebuild writes an entry of its own. Waiting would find that
    // one and pass whether or not the old one was ever thrown away. The rebuild does write
    // one, and should: a refresh after a reset comes back to the reset machine.
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('leaves nothing to undo, since there is nothing to go back to', async () => {
    const { api } = renderViewer({ viewStateKey: KEY });
    await waitFor(() => expect(instances).toHaveLength(1));
    act(() => lastCy().handlers['grab']?.({}));
    await waitFor(() => expect(api().canUndo).toBe(true));

    act(() => api().resetMachine());
    await waitFor(() => expect(api().canUndo).toBe(false));
  });
});
