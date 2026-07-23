'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Shared helpers for the assignment analytics charts (histogram, box plots, status bar).
 * The charts are hand-drawn SVG rather than a charting library: the box plot has no
 * off-the-shelf component, and drawing them ourselves keeps full control over theming
 * (CSS variables, light/dark), reduced motion, and keyboard/screen-reader behaviour.
 */

/** Round to at most one decimal place, dropping a trailing ".0". */
export function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** Whole-number percent for count-of-total figures (e.g. "25%"). */
export function fmtPct(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

/**
 * Track an element's rendered width via ResizeObserver so charts can lay out in real
 * pixels (crisp strokes, undistorted circles) instead of a stretched viewBox. Falls back
 * to a sensible width before the first measurement / during SSR.
 */
export function useMeasuredWidth(fallback = 640): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth || fallback);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);

  return [ref, width];
}

export type TooltipState = { x: number; y: number; content: ReactNode } | null;

/**
 * Minimal tooltip controller shared by all three charts. `showAtEvent` positions from a
 * pointer event; `showAtElement` positions from an element's box (used on keyboard focus
 * so the tooltip appears for keyboard users too).
 */
export function useChartTooltip() {
  const [state, setState] = useState<TooltipState>(null);
  const showAtEvent = useCallback(
    (e: { clientX: number; clientY: number }, content: ReactNode) =>
      setState({ x: e.clientX, y: e.clientY, content }),
    [],
  );
  const showAtElement = useCallback((el: Element, content: ReactNode) => {
    const r = el.getBoundingClientRect();
    setState({ x: r.left + r.width / 2, y: r.top, content });
  }, []);
  const hide = useCallback(() => setState(null), []);
  return { state, showAtEvent, showAtElement, hide };
}

/**
 * Portal tooltip that clamps itself inside the viewport (so it never overflows the
 * screen edge) and flips below the anchor when there isn't room above.
 */
export function ChartTooltip({ state }: { state: TooltipState }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!state || !ref.current) {
      setPos(null);
      return;
    }
    const { width, height } = ref.current.getBoundingClientRect();
    const pad = 8;
    let left = state.x - width / 2;
    let top = state.y - height - 10;
    left = Math.max(pad, Math.min(left, window.innerWidth - width - pad));
    // Not enough room above the anchor: drop below it instead.
    if (top < pad) top = state.y + 16;
    top = Math.min(top, window.innerHeight - height - pad);
    setPos({ left, top });
  }, [state]);

  if (!state || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="bg-popover text-popover-foreground pointer-events-none fixed z-50 max-w-xs rounded-md border px-3 py-2 text-xs shadow-md"
      style={{
        left: pos?.left ?? state.x,
        top: pos?.top ?? state.y,
        // Hide for the first paint until measured, so it doesn't flash in the wrong spot.
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {state.content}
    </div>,
    document.body,
  );
}

/**
 * A visually hidden but screen-reader-available data table. Every chart renders one so the
 * information is never locked inside SVG or conveyed by colour alone.
 */
export function ChartDataTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) =>
              j === 0 ? (
                <th key={j} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={j}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
