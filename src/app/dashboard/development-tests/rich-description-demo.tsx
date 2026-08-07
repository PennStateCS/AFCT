'use client';

import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { RichDescriptionEditor } from '@/components/rich-description/RichDescriptionEditor';
import type { RichDescriptionEnvelope } from '@/lib/rich-description';
import { richDescriptionToPlainText } from '@/lib/rich-description';

/**
 * Dev-only harness for the shared rich-description editor. Shows a normal editor, the derived
 * plain text (what legacy clients would receive), and the disabled/read-only states, so the
 * component can be judged on its own before it is wired into any form.
 */
export function RichDescriptionDemo() {
  const [value, setValue] = useState<RichDescriptionEnvelope | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor="demo-editor-label" className="mb-2 block">
          Description
        </Label>
        <span id="demo-editor-label" className="sr-only">
          Description
        </span>
        <RichDescriptionEditor
          showToolbar
          ariaLabelledBy="demo-editor-label"
          ariaDescribedBy="demo-editor-help"
          value={value}
          onChange={setValue}
        />
        <p id="demo-editor-help" className="text-muted-foreground mt-1 text-xs">
          Paragraphs, headings, bold, italic, underline, alignment, links, equations, lists, quotes,
          code, and rules. Click an equation to edit it, or use Expand editor for a full-window
          view.
        </p>
      </div>

      <div>
        <p className="mb-1 text-sm font-medium">Derived plain text (what legacy clients get)</p>
        <pre className="bg-muted max-h-40 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
          {value ? richDescriptionToPlainText(value) || '(empty)' : '(empty)'}
        </pre>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-sm font-medium">Disabled</p>
          <RichDescriptionEditor
            ariaLabel="Disabled example"
            disabled
            value="Cannot be edited."
            minHeightClassName="min-h-24"
          />
        </div>
        <div>
          <p className="mb-1 text-sm font-medium">Read-only</p>
          <RichDescriptionEditor
            ariaLabel="Read-only example"
            readOnly
            value="Read-only, not styled as disabled."
            minHeightClassName="min-h-24"
          />
        </div>
      </div>
    </div>
  );
}
