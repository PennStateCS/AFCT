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
        const { lines: incoming } = JSON.parse((e as MessageEvent).data) as { lines: string[] };
        setLines((prev) => {
          const next = [...prev, ...incoming];
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

  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs font-medium">Live progress</p>
      <div
        ref={boxRef}
        role="log"
        aria-live="off"
        aria-label="Live upgrade log"
        tabIndex={0}
        className="bg-muted/30 focus-visible:ring-ring max-h-80 overflow-auto rounded-md border p-2 font-mono text-xs leading-relaxed focus-visible:ring-2 focus-visible:outline-none"
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
