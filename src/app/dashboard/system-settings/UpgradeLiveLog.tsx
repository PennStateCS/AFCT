'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Live, streaming detail of an in-flight upgrade. Opens a Server-Sent Events
 * connection to the updater's progress stream and appends each line as it arrives,
 * so the admin sees exactly what's happening (image pull, container recreate)
 * without polling or refreshing. The coarse phase is still shown by the step
 * checklist above this; this is the moment-to-moment detail.
 *
 * Accessibility: the log region is intentionally `aria-live="off"` — a screen
 * reader shouldn't read every streamed line. The checklist's own status region
 * announces phase changes. The box is focusable so keyboard users can scroll it.
 */
export function UpgradeLiveLog({ active }: { active: boolean }) {
  const [lines, setLines] = useState<string[]>([]);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active) return;
    setLines([]);
    const es = new EventSource('/api/admin/settings/upgrade/stream');
    es.addEventListener('log', (e) => {
      try {
        const { lines: incoming, reset } = JSON.parse((e as MessageEvent).data) as {
          lines: string[];
          reset?: boolean;
        };
        setLines((prev) => {
          // A new run truncated the log, so whatever is on screen belongs to the previous
          // one. Replace rather than append: starting an upgrade while a self-update was
          // still displayed used to leave the old run's lines above the new run's, and the
          // effect below cannot catch it because `active` never flips between the two.
          const next = reset ? [...incoming] : [...prev, ...incoming];
          // Bound memory/DOM, but keep enough that a whole run stays scrollable rather
          // than dropping its early lines. (The updater also trims progress.log itself,
          // so this cap is only a backstop for an unusually chatty run.)
          return next.length > 5000 ? next.slice(next.length - 5000) : next;
        });
      } catch {
        // ignore a malformed frame
      }
    });
    es.addEventListener('done', () => es.close());
    // EventSource auto-reconnects on a dropped connection; no handling needed.
    return () => es.close();
  }, [active]);

  // Keep the newest line in view.
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (!active || lines.length === 0) return null;

  // Styled as a console: a title bar with the familiar window dots, then a dark,
  // monospace log body. Deliberately dark in both themes, the way a terminal is.
  return (
    <div className="overflow-hidden rounded-md border border-zinc-700 bg-zinc-950 shadow-inner">
      <div className="flex items-center gap-2 border-b border-zinc-700 bg-zinc-900 px-3 py-1.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-red-500/80" />
          <span className="size-2.5 rounded-full bg-yellow-500/80" />
          <span className="size-2.5 rounded-full bg-green-500/80" />
        </span>
        <span className="text-xs font-medium text-zinc-400">Live progress</span>
      </div>
      <div
        ref={boxRef}
        role="log"
        aria-live="off"
        aria-label="Live upgrade log"
        tabIndex={0}
        className="max-h-80 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed text-zinc-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none focus-visible:ring-inset"
      >
        {lines.map((line, i) => (
          <div key={i} className="break-words whitespace-pre-wrap">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
