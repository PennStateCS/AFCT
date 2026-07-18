'use client';

import * as React from 'react';
import { GripVertical } from 'lucide-react';
import * as ResizablePrimitive from 'react-resizable-panels';

import { cn } from '@/lib/utils';

/**
 * Thin shadcn-style wrapper over react-resizable-panels (v4). v4 renamed the
 * primitives: `Group` (was PanelGroup), `Panel`, and `Separator` (was
 * PanelResizeHandle). The Group manages its own flex layout, so we only layer on
 * sizing and theme styles here. Used for a horizontal split; if a vertical group
 * is ever needed, add orientation-aware handle styles.
 */
function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) {
  return <ResizablePrimitive.Group className={cn('flex h-full w-full', className)} {...props} />;
}

const ResizablePanel = ResizablePrimitive.Panel;

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & { withHandle?: boolean }) {
  return (
    <ResizablePrimitive.Separator
      className={cn(
        // A thin vertical bar with a larger invisible hit area, centered grip.
        'bg-border hover:bg-primary/40 focus-visible:ring-ring relative flex w-px items-center justify-center transition-colors after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-none',
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div className="bg-border z-10 flex h-4 w-3 items-center justify-center rounded-xs border">
          <GripVertical className="h-2.5 w-2.5" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
