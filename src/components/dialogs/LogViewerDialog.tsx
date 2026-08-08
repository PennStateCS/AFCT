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
import { Copy } from 'lucide-react';

export function LogViewerDialog({
  data,
  open,
  onOpenChange,
  title,
}: {
  data: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string | null | undefined;
}) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data);
      showToast.success('Copied to clipboard');
    } catch (err) {
      showToast.error('Error copying data');
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
          className="themed-scroll focus-visible:ring-ring min-h-0 flex-1 overflow-y-auto text-left font-mono text-sm whitespace-pre-wrap focus-visible:ring-2 focus-visible:outline-none"
        >
          {data || ''}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
            <Copy className="h-4 w-4" />
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
