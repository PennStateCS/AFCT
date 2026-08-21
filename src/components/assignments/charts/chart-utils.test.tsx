/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ChartDataTable,
  ChartTooltip,
  fmt1,
  fmtPct,
  useChartTooltip,
  useMeasuredWidth,
} from './chart-utils';

/**
 * The shared pieces behind the three assignment analytics charts.
 *
 * Two reasons this is worth testing even though charts are "just display". The numbers are
 * grade distributions, so a rounding or percentage bug misreports how a class did; and
 * `ChartDataTable` is the ONLY way the chart data reaches a screen reader, since the charts
 * themselves are hand-drawn SVG. A broken table means the information is conveyed visually
 * and by colour alone.
 *
 * jsdom does no layout, so the geometry here is driven by stubbed rects rather than measured.
 * That is enough for the clamping arithmetic, which is the part with branches in it.
 */

afterEach(() => vi.restoreAllMocks());

describe('fmt1', () => {
  it.each([
    [0, '0'],
    [3, '3'],
    [3.04, '3'],
    [3.05, '3.1'],
    [3.14159, '3.1'],
    [-2.55, '-2.5'],
    [99.99, '100'],
  ])('formats %p as %p', (input, expected) => {
    expect(fmt1(input)).toBe(expected);
  });

  it('drops the trailing .0 rather than printing it', () => {
    expect(fmt1(7.0)).toBe('7');
    expect(fmt1(7.049)).toBe('7');
  });
});

describe('fmtPct', () => {
  it('renders a whole-number percent', () => {
    expect(fmtPct(1, 4)).toBe('25%');
    expect(fmtPct(2, 3)).toBe('67%');
    expect(fmtPct(3, 3)).toBe('100%');
  });

  it('returns 0% for an empty total instead of dividing by zero', () => {
    // A cohort with no submissions is ordinary early in a term; NaN% on the screen is not.
    expect(fmtPct(0, 0)).toBe('0%');
    expect(fmtPct(5, 0)).toBe('0%');
    expect(fmtPct(1, -3)).toBe('0%');
  });
});

describe('useMeasuredWidth', () => {
  function Probe({ fallback }: { fallback?: number }) {
    const [ref, width] = useMeasuredWidth(fallback);
    return (
      <div ref={ref} data-testid="box">
        {width}
      </div>
    );
  }

  it('uses the fallback width before anything has been measured', () => {
    render(<Probe />);
    // jsdom reports clientWidth 0, which is the same situation as the first paint in a browser.
    expect(screen.getByTestId('box')).toHaveTextContent('640');
  });

  it('honours a caller-supplied fallback', () => {
    render(<Probe fallback={320} />);
    expect(screen.getByTestId('box')).toHaveTextContent('320');
  });

  it('prefers a real measurement when the element has one', () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 900,
    });
    render(<Probe />);
    expect(screen.getByTestId('box')).toHaveTextContent('900');
  });

  it('disconnects its observer on unmount', () => {
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect = disconnect;
      },
    );
    const { unmount } = render(<Probe />);
    unmount();
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('useChartTooltip', () => {
  function Probe() {
    const { state, showAtEvent, showAtElement, hide } = useChartTooltip();
    return (
      <div>
        <span data-testid="state">{state ? `${state.x},${state.y}:${state.content}` : 'none'}</span>
        <button onClick={() => showAtEvent({ clientX: 10, clientY: 20 }, 'from pointer')}>
          pointer
        </button>
        <button
          data-testid="anchor"
          onClick={(e) => showAtElement(e.currentTarget, 'from element')}
        >
          element
        </button>
        <button onClick={hide}>hide</button>
      </div>
    );
  }

  it('starts with nothing shown', () => {
    render(<Probe />);
    expect(screen.getByTestId('state')).toHaveTextContent('none');
  });

  it('positions from a pointer event', () => {
    render(<Probe />);
    act(() => screen.getByText('pointer').click());
    expect(screen.getByTestId('state')).toHaveTextContent('10,20:from pointer');
  });

  it('positions from an element box, which is what keyboard focus uses', () => {
    render(<Probe />);
    const anchor = screen.getByTestId('anchor');
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 50,
      width: 40,
      height: 10,
    } as unknown as DOMRect);

    act(() => anchor.click());
    // Horizontally centred on the element, anchored at its top edge.
    expect(screen.getByTestId('state')).toHaveTextContent('120,50:from element');
  });

  it('hides again', () => {
    render(<Probe />);
    act(() => screen.getByText('pointer').click());
    act(() => screen.getByText('hide').click());
    expect(screen.getByTestId('state')).toHaveTextContent('none');
  });
});

describe('ChartTooltip', () => {
  const rect = (width: number, height: number) =>
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width,
      height,
      left: 0,
      top: 0,
    } as unknown as DOMRect);

  const viewport = (w: number, h: number) => {
    window.innerWidth = w;
    window.innerHeight = h;
  };

  it('renders nothing when there is no state', () => {
    const { container } = render(<ChartTooltip state={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('centres above the anchor when there is room', () => {
    viewport(1000, 800);
    rect(100, 40);
    render(<ChartTooltip state={{ x: 500, y: 400, content: 'hi' }} />);

    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveStyle({ left: '450px', top: '350px' });
    expect(tip).toHaveTextContent('hi');
  });

  it('flips below the anchor when it would overflow the top', () => {
    viewport(1000, 800);
    rect(100, 40);
    render(<ChartTooltip state={{ x: 500, y: 5, content: 'hi' }} />);

    // 5 - 40 - 10 is off-screen, so it drops to y + 16 instead.
    expect(screen.getByRole('tooltip')).toHaveStyle({ top: '21px' });
  });

  it('clamps to the left edge', () => {
    viewport(1000, 800);
    rect(100, 40);
    render(<ChartTooltip state={{ x: 2, y: 400, content: 'hi' }} />);
    expect(screen.getByRole('tooltip')).toHaveStyle({ left: '8px' });
  });

  it('clamps to the right edge', () => {
    viewport(1000, 800);
    rect(100, 40);
    render(<ChartTooltip state={{ x: 995, y: 400, content: 'hi' }} />);
    // 1000 - 100 - 8
    expect(screen.getByRole('tooltip')).toHaveStyle({ left: '892px' });
  });

  it('clamps to the bottom edge', () => {
    viewport(1000, 200);
    rect(100, 40);
    render(<ChartTooltip state={{ x: 500, y: 30, content: 'hi' }} />);
    // Flipped below to 46, then clamped against 200 - 40 - 8.
    expect(screen.getByRole('tooltip')).toHaveStyle({ top: '46px' });
  });

  it('is inert to the pointer, so it cannot swallow the hover that created it', () => {
    viewport(1000, 800);
    rect(100, 40);
    render(<ChartTooltip state={{ x: 500, y: 400, content: 'hi' }} />);
    expect(screen.getByRole('tooltip').className).toContain('pointer-events-none');
  });

  it('renders into the body rather than the chart, so SVG clipping cannot cut it off', () => {
    viewport(1000, 800);
    rect(100, 40);
    const { container } = render(<ChartTooltip state={{ x: 500, y: 400, content: 'hi' }} />);
    expect(container).toBeEmptyDOMElement();
    expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();
  });
});

describe('ChartDataTable', () => {
  const rows = [
    ['0-59', 4, '25%'],
    ['60-79', 8, '50%'],
    ['80-100', 4, '25%'],
  ];

  it('exposes the chart data as a real table for screen readers', () => {
    render(
      <ChartDataTable
        caption="Score distribution"
        headers={['Band', 'Count', 'Share']}
        rows={rows}
      />,
    );

    const table = screen.getByRole('table', { name: 'Score distribution' });
    expect(table).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Band',
      'Count',
      'Share',
    ]);
    expect(screen.getAllByRole('row')).toHaveLength(4); // header + 3
  });

  it('makes the first cell of each row its row header', () => {
    render(
      <ChartDataTable
        caption="Score distribution"
        headers={['Band', 'Count', 'Share']}
        rows={rows}
      />,
    );

    const rowHeaders = screen.getAllByRole('rowheader');
    expect(rowHeaders.map((h) => h.textContent)).toEqual(['0-59', '60-79', '80-100']);
    // Scopes are what let a screen reader announce "80-100, Count, 4" rather than a bare number.
    rowHeaders.forEach((h) => expect(h).toHaveAttribute('scope', 'row'));
    screen.getAllByRole('columnheader').forEach((h) => expect(h).toHaveAttribute('scope', 'col'));
  });

  it('is visually hidden but not hidden from assistive technology', () => {
    render(<ChartDataTable caption="Score distribution" headers={['Band']} rows={[['0-59']]} />);
    const table = screen.getByRole('table', { name: 'Score distribution' });
    expect(table.className).toContain('sr-only');
    expect(table).not.toHaveAttribute('aria-hidden');
  });

  it('renders an empty body without crashing', () => {
    render(<ChartDataTable caption="No data yet" headers={['Band', 'Count']} rows={[]} />);
    expect(screen.getByRole('table', { name: 'No data yet' })).toBeInTheDocument();
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0);
  });
});

/**
 * WCAG 1.4.13 requires that content appearing on hover or focus can be dismissed without
 * moving the pointer or the focus. The chart tooltips had no way out but to move one of them,
 * which a magnifier user reading around the tooltip does not have comfortably available.
 */
describe('dismissing a chart tooltip', () => {
  function Probe() {
    const { state, showAtEvent } = useChartTooltip();
    return (
      <div>
        <span data-testid="state">{state ? String(state.content) : 'none'}</span>
        <button onClick={() => showAtEvent({ clientX: 10, clientY: 20 }, 'shown')}>show</button>
      </div>
    );
  }

  it('closes on Escape, without the pointer or focus moving', () => {
    render(<Probe />);
    act(() => screen.getByText('show').click());
    expect(screen.getByTestId('state')).toHaveTextContent('shown');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(screen.getByTestId('state')).toHaveTextContent('none');
  });

  it('ignores other keys, so typing elsewhere does not close it', () => {
    render(<Probe />);
    act(() => screen.getByText('show').click());

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });

    expect(screen.getByTestId('state')).toHaveTextContent('shown');
  });
});
