'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export function LogViewerDialog({ data, open, onOpenChange, title }: { data: string; open: boolean; onOpenChange: (v: boolean) => void; title: string | null | undefined;}){

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
        </DialogContent>
      </Dialog>
    </div>
  );
}
