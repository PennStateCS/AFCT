'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '@/lib/utils';

/*
 * A note on the tooltip's fill, because it is spelled out twice below and has to stay that way.
 *
 * The bubble and its arrow both paint `var(--tooltip-surface,var(--primary))`. They used to be
 * set separately, `bg-primary` on the body and `fill-sidebar` on the arrow, and the arrow's token
 * had been changed at some point to suit the three sidebar tooltips that override the body to
 * `bg-sidebar`. That made those three correct and the other eighteen wrong: a cobalt bubble with
 * a near-black diamond hanging off the bottom of it.
 *
 * The default lives in the variable's own fallback rather than in a class. Setting it twice, once
 * here and once in a caller's className, would be two arbitrary-property utilities of equal
 * specificity racing on stylesheet order. This way exactly one place ever sets it, and a caller
 * that wants a different surface sets `[--tooltip-surface:var(--sidebar)]` rather than a `bg-*`
 * class, so the arrow follows on its own.
 *
 * Both classes are written out in full, NOT built from a shared constant. Tailwind finds classes
 * by scanning source text, so a name assembled through a template literal is a name it never sees
 * and never generates: trying that here produced a transparent bubble and a black arrow, which is
 * a worse version of the bug being fixed.
 */

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'bg-[var(--tooltip-surface,var(--primary))] text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-[var(--tooltip-surface,var(--primary))] fill-[var(--tooltip-surface,var(--primary))]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
