'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { DEFAULT_EPS } from '@/components/useJffCytoscape';

function parseCfg(xmlText: string, epsSymbol: string) {
  type MachineType = 'cfg' | 're' | 'fa' | 'pda' | 'unknown';
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    const msg = parseError.textContent?.split('\n')[0]?.trim() || 'XML parse error';
    throw new Error(`Invalid JFLAP (.jff) file: ${msg}`);
  }

  const rawType = (doc.querySelector('type')?.textContent || '').toLowerCase();
  let type: MachineType = 'unknown';
  if (rawType.includes('cfg') || rawType.includes('grammar')) type = 'cfg';

  if (type === 'unknown') {
    throw new Error(`${rawType} not context free grammar`);
  }

  const productions = doc.querySelectorAll('production');
  const left: string[] = [];
  const right: string[] = [];
  // JFLAP writes an epsilon production as an EMPTY <right></right>, not a missing one, so
  // this has to test for blank rather than for null. Rendering that as a blank cell read as
  // "the answer has a hole in it"; it is the epsilon rule.
  productions.forEach((node) => {
    const [lNode, rNode] = node.children;
    const rhs = rNode?.textContent ?? '';
    left.push(lNode?.textContent ?? '');
    right.push(rhs.trim() === '' ? epsSymbol : rhs);
  });

  return { type: type, left: left, right: right };
}

export function CfgViewerDialog({
  src,
  open,
  onOpenChange,
  title,
  epsSymbol = DEFAULT_EPS,
}: {
  src: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string | null | undefined;
  epsSymbol?: string;
}) {
  const [data, setData] = React.useState<string | null>(null);

  if (!title) {
    title = '';
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

    void load();
  }, [src, open]);
  if (!data) return null;
  const parsed = parseCfg(data, epsSymbol);
  return (
    <div className="p-8">
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            {/* Wraps rather than truncating, and `leading-snug` overrides the shared
                title's `leading-none` so clamping does not behead the descender in a
                `.jff`. These titles are a file name followed by the problem's own title,
                so a single line runs off the edge on any real pair of names. Same fix the
                automaton viewer got. */}
            <DialogTitle className="line-clamp-2 leading-snug break-words">
              {title || 'JFLAP Viewer'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Context-free grammar productions.
            </DialogDescription>
            <table className="w-full text-sm">
              <thead className="border-foreground border-b">
                <tr>
                  <th className="text-foreground border-foreground border-r py-2 text-center font-medium">
                    LHS
                  </th>
                  <th className="text-foreground py-2 text-center font-medium">RHS</th>
                </tr>
              </thead>

              <tbody>
                {parsed.left.map((left, index) => (
                  <tr key={index} className="border-foreground border-b last:border-0">
                    <td className="text-foreground border-foreground border-r py-2 text-center font-medium">
                      {left}
                    </td>
                    <td className="text-foreground py-2 text-center font-medium">
                      {parsed.right[index]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}
