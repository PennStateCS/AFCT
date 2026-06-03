'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { showToast } from '@/lib/toast';
import { Copy } from 'lucide-react';

export function LogViewerDialog({ data, open, onOpenChange, title }: { data: string; open: boolean; onOpenChange: (v: boolean) => void; title: string | null | undefined;}){
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data);
      showToast.success("Copied data")
    } catch (err) {
      showToast.error("Error copying data");
      console.error(err);
    }
  };

  return (
    <div className="p-8">
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="truncate">{title || 'System Log'}</DialogTitle>
            </DialogHeader>
		          <div className="p-4 pt-2 text-left whitespace-pre-wrap font-mono text-sm">
              {data || ''}
              </div>
              <button className="flex justify-end" onClick={handleCopy}>
                <Copy className="text-right h-4 w-4 cursor-pointer" />
              </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
