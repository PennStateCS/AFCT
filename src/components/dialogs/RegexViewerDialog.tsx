'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

function parseRegex(xmlText: string) {
  type MachineType = 'cfg' | 're' | 'fa' | 'pda' | 'unknown';
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    const msg = parseError.textContent?.split('\n')[0]?.trim() || 'XML parse error';
    throw new Error(`Invalid JFLAP (.jff) file: ${msg}`);
  }

  const rawType = (doc.querySelector('type')?.textContent || '').toLowerCase();
  let type: MachineType = 'unknown';
  if (rawType.includes('re')) type = 're';

  if (type === 'unknown') {
    throw new Error(`${rawType} not regular expression`);
  }

  const expression = doc.querySelector('expression')?.textContent ?? '';
  return { type: type, expression: expression };
}

/**
 * The expression itself, without a dialog around it.
 *
 * Split out so two submissions can be shown side by side on the Similarity tab; the dialog
 * below is the same view with its own frame, and stays the way every other caller uses it.
 */
export function RegexViewerContent({ src }: { src: string }) {
  const [data, setData] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`Failed to Fetch : ${res.status} ${res.statusText}`);
        const text = await res.text();
        if (!cancelled) {
          setData(text);
          setError(null);
        }
      } catch (err) {
        console.error('Fetch error:', err);
        // Recorded rather than swallowed: returning null left a dialog holding only its title.
        if (!cancelled) setError('This expression could not be loaded.');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (error) {
    return (
      <p role="alert" className="text-destructive p-4 pt-2 text-sm">
        {error}
      </p>
    );
  }

  if (!data) {
    return (
      <p role="status" className="text-muted-foreground p-4 pt-2 text-sm">
        Loading the expression...
      </p>
    );
  }

  // Parsed here rather than in an effect, but guarded: `parseRegex` throws on a file that is
  // not a regular expression, and an exception during render blanks the page, not the dialog.
  let expression: string;
  try {
    expression = parseRegex(data).expression;
  } catch (err) {
    console.error('Parse error:', err);
    return (
      <p role="alert" className="text-destructive p-4 pt-2 text-sm">
        This expression could not be read. The file may be damaged.
      </p>
    );
  }

  return <div className="p-4 pt-2 text-center">{expression}</div>;
}

export function RegexViewerDialog({
  src,
  open,
  onOpenChange,
  title,
}: {
  src: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string | null | undefined;
}) {
  if (!title) {
    title = '';
  }

  return (
    <div className="p-8">
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            {/* Wraps rather than truncating; see CfgViewerDialog for why `leading-snug`. */}
            <DialogTitle className="line-clamp-2 leading-snug break-words">
              {title || 'JFLAP Viewer'}
            </DialogTitle>
            <DialogDescription className="sr-only">Regular expression contents.</DialogDescription>
          </DialogHeader>
          <RegexViewerContent src={src} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
