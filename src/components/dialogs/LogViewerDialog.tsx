'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';
import { Braces, Copy } from 'lucide-react';

export function LogViewerDialog({
  data,
  json,
  open,
  onOpenChange,
  title,
}: {
  data: string;
  /**
   * The entry as it was received, pretty-printed.
   *
   * Two buttons rather than a choice made on the reader's behalf. The rendered text is what
   * somebody pastes into an email about a student; the JSON is what they attach to a bug
   * report or keep as the disclosure record, where the exact field names matter.
   */
  json: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string | null | undefined;
}) {
  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast.success(`${what} copied to clipboard`);
    } catch (err) {
      // Denied permission, or an insecure origin. Say so rather than leaving the button
      // looking like it worked.
      showToast.error(`Could not copy the ${what.toLowerCase()}`);
      console.error(err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A column with one scrolling row in the middle, rather than letting the whole dialog
          scroll: a long entry used to carry the title, the close button and Copy off the top
          and bottom with it. `flex` and `overflow-hidden` override the grid and overflow-y-auto
          DialogContent sets by default. */}
      <DialogContent className="flex flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{title || 'System Log'}</DialogTitle>
          <DialogDescription className="sr-only">Raw log file contents.</DialogDescription>
        </DialogHeader>

        {/* min-h-0 lets this shrink below its content so it actually scrolls; without it a flex
            child is floored at its content height and pushes the footer out of the dialog.
            Focusable and named because a scroll container a mouse can reach has to be reachable
            by keyboard too. */}
        <div
          role="region"
          aria-label="Log contents"
          tabIndex={0}
          className="themed-scroll focus-visible:ring-ring min-h-0 flex-1 overflow-y-auto text-left font-mono text-sm break-words whitespace-pre-wrap focus-visible:ring-2 focus-visible:outline-none"
        >
          {data || ''}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => copy(data, 'Text')}
          >
            <Copy className="h-4 w-4" />
            Copy text
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => copy(json, 'JSON')}>
            <Braces className="h-4 w-4" />
            Copy JSON
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
