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

function parseRegexCfg(xmlText: string){
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    const msg = parseError.textContent?.split('\n')[0]?.trim() || 'XML parse error';
    throw new Error(`Invalid JFLAP (.jff) file: ${msg}`);
  }
  
  const rawType = (doc.querySelector('type')?.textContent || '').toLowerCase();
  let type: MachineType = 'unknown';
  if (rawType.includes('re')) type = 're';
  else if (rawType.includes('cfg')) type = 'cfg';

  if (type === 'unknown'){
    throw new Error(`${rawType} not regular expression or context free grammar`);
  }

  if (type === 're'){
    let expression = doc.querySelector('expression').textContent;
	console.log("EXPRESSION: " + expression);
	return { type: type, expression: expression }; 
  }

  let productions = doc.querySelectorAll('production');

  let left = prodcutions.querySelectorAll('left');
  let right = productions.querySelectorAll('right');

  return { type: type, left: left, right: right };
}

export function RegexCfgViewerDialog({ src, open, onOpenChange, title }: { src: string; open: boolean; onOpenChange: (v: boolean) => void; title: string;}){

  const [data, setData] = React.useState(null);

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
  let parsed = parseRegexCfg(data);
  if (parsed.type === "re"){
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
}
