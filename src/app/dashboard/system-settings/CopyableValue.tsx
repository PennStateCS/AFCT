'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/** How long "copied" stays on the button before it offers to copy again. */
const COPIED_MS = 2000;

/**
 * A value you are meant to read and paste somewhere else, not edit.
 *
 * System Settings is full of these: the server's public address, and the four LTI endpoints
 * an LMS wants. Every one of them used to render as a read-only InputGroup, which is the
 * wrong shape twice over. It looks like a field that refuses to work, and it makes the
 * thing you actually came to do, copy it, the one thing there is no control for.
 *
 * The value sits on a quiet inset inside the card rather than on the card's own surface, so
 * it reads as a payload rather than as more prose.
 */
export function CopyableValue({
  label,
  value,
  copyName,
  description,
  canCopy = true,
  className,
}: {
  /** Shown above the value. Omit when the card's own title already names it. */
  label?: string;
  value: string;
  /**
   * What the copy button says it copies, e.g. "login initiation URL". Defaults to the
   * label. A page with four of these needs four distinct names, or every button is just
   * "Copy" to a screen reader.
   */
  copyName?: string;
  /** A caveat that belongs to this value specifically, not to the card. */
  description?: React.ReactNode;
  /** False while the value is still loading, or when there is nothing to copy. */
  canCopy?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleared on unmount, so switching tabs mid-countdown cannot set state on a gone component.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const name = copyName ?? label ?? 'value';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // Copying can be refused (an insecure origin, a denied permission). The value is on
      // screen and selectable, so say that rather than leaving the button claiming a
      // success that did not happen.
      setCopied(false);
      showToast.error(`Could not copy. Select the ${name} and copy it manually.`);
    }
  };

  return (
    <div className={cn('space-y-1', className)}>
      {label ? <p className="text-foreground text-sm font-medium">{label}</p> : null}

      {/* min-w-0 + break-all so a production hostname wraps inside the rail instead of
          pushing the button out of it; shrink-0 keeps the button reachable either way. */}
      <div className="bg-muted flex items-start gap-2 rounded-md border p-2">
        <span className="text-foreground min-w-0 flex-1 font-mono text-xs break-all">{value}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="size-7 shrink-0"
          onClick={() => void copy()}
          disabled={!canCopy}
          // Icon-only: at 288px a "Copy" label takes a third of the row away from the value.
          aria-label={`Copy ${name}`}
        >
          {copied ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
        </Button>
      </div>

      {/* One live region per value, so the result is announced once and the value itself is
          not read out again. Capitalised, because `name` is written for the button's
          "Copy target link URI" and reads as a fragment at the start of a sentence. */}
      <p role="status" aria-live="polite" className="sr-only">
        {copied ? `${name.charAt(0).toUpperCase()}${name.slice(1)} copied to the clipboard.` : ''}
      </p>

      {description ? (
        <p className="text-muted-foreground text-xs leading-4.5">{description}</p>
      ) : null}
    </div>
  );
}

export default CopyableValue;
