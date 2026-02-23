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

function parseRegex(xmlText: string){
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

  if (type === 'unknown'){
    throw new Error(`${rawType} not regular expression`);
  }

  let expression = doc.querySelector('expression').textContent;
  return { type: type, expression: expression }; 
}

export function RegexViewerDialog({ src, open, onOpenChange, title }: { src: string; open: boolean; onOpenChange: (v: boolean) => void; title: string | null | undefined;}){

  const [data, setData] = React.useState<string | null>(null);

  if (!title){
    title = "";
  }
  React.useEffect(() => {
	
	const load = async () => {
      try {
	    const res = await fetch(src);
	    if (!res.ok) throw new Error(`Failed to Fetch : ${res.status} ${res.statusText}`);
	    const text = await res.text();
		setData(text);
      } catch (err) {
		console.error('Fetch error:', err);
      }
	};

	load();
  }, [src, open]);
  if (!data) return null;
  let parsed = parseRegex(data);
  return (
    <div className="p-8">

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="truncate">{title ?? 'JFLAP Viewer'}</DialogTitle>
            <DialogDescription>
			  <div className="h-full p-4 pt-2" style={{ textAlign: 'center' }}>
                {parsed.expression}
              </div>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}
