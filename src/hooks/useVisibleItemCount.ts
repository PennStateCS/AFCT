import { useLayoutEffect, useState } from 'react';

export type VisibleItemOptions = {
  conservativeMargin?: number; // pixels to subtract as a safety margin
  sampleText?: string; // fallback sample text when no live item exists
};

export default function useVisibleItemCount(
  containerRef: React.RefObject<HTMLElement | null>,
  itemsLength: number,
  options: VisibleItemOptions = {}
) {
  const { conservativeMargin = 10, sampleText = 'Sample' } = options;

  const [visibleCount, setVisibleCount] = useState<number>(itemsLength);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      setVisibleCount(itemsLength);
      return;
    }

    let raf = 0;

    const calc = () => {
      const containerHeight = container.clientHeight;
      if (containerHeight <= 0) {
        setVisibleCount(itemsLength);
        return;
      }

      let count = 0;

      // Prefer measuring a real rendered item (fast, no clones)
      const first = container.querySelector<HTMLElement>('a.assignment-link');
      if (first) {
        const itemRect = first.getBoundingClientRect();
        const itemHeight = Math.max(0, itemRect.height);

        // compute gap using next sibling if available, otherwise fall back to container gap
        let gap = 0;
        const second = first.nextElementSibling as HTMLElement | null;
        if (second) {
          gap = second.offsetTop - (first.offsetTop + first.offsetHeight);
          if (isNaN(gap) || gap < 0) gap = 0;
        } else {
          const cs = getComputedStyle(container);
          gap = parseFloat(cs.rowGap || cs.gap || '0') || 0;
        }

        const step = itemHeight + gap;
        if (step > 0) {
          count = Math.floor((Math.max(0, containerHeight - conservativeMargin) + gap) / step);
        }

        if (process.env.NODE_ENV !== 'production') {
          console.debug('assignment-metrics', { itemHeight, gap, containerHeight, conservativeMargin, count });
        }
      } else {
        // Fallback: create a single clone to measure item height
        const sample = document.createElement('a');
        sample.className = 'assignment-link block w-full min-w-0 min-h-[1rem] box-border bg-sky-700 text-left text-white text-xs rounded py-0.5 pl-1 truncate whitespace-nowrap overflow-hidden leading-tight';
        sample.textContent = sampleText ?? 'Sample';
        sample.style.position = 'absolute';
        sample.style.left = '-9999px';
        sample.style.top = '0';
        sample.style.visibility = 'hidden';
        sample.style.width = `${container.clientWidth}px`;
        document.body.appendChild(sample);

        const h = Math.max(0, sample.getBoundingClientRect().height);
        document.body.removeChild(sample);

        const cs = getComputedStyle(container);
        const gap = parseFloat(cs.rowGap || cs.gap || '0') || 0;

        if (h > 0) count = Math.floor((Math.max(0, containerHeight - conservativeMargin) + gap) / (h + gap));
      }

      // Conservative cutoff: hide one extra box early to avoid clipping at the boundary (matching previous behavior)
      const conservativeCount = Math.max(0, count - 1);
      const finalCount = Math.max(0, Math.min(itemsLength, conservativeCount));
      if (process.env.NODE_ENV !== 'production') {
        console.debug('assignment-metrics-final', { conservativeCount, finalCount, count });
      }

      setVisibleCount(prev => (prev === finalCount ? prev : finalCount));
    };

    const scheduleCalc = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(calc);
    };

    const ro = new ResizeObserver(() => scheduleCalc());
    ro.observe(container);

    const onResize = () => scheduleCalc();
    window.addEventListener('resize', onResize, { passive: true });

    // initial measurement
    scheduleCalc();

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, [containerRef, itemsLength, conservativeMargin, sampleText]);

  return visibleCount;
}
