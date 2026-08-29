'use client';

import { useState, type ReactNode } from 'react';
import { Maximize2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * The card the statistics pages are built out of.
 *
 * Two pages draw these now, the assignment one and the course one, and they have to be the
 * same object: the same header, the same way to see a chart full size, the same empty state
 * when a course is two weeks old. A professor moving between the two levels is answering one
 * question at two scales and should not have to learn a second screen to do it.
 */

/**
 * One chart, with a way to see it bigger.
 *
 * These charts are read at a glance and then squinted at: a box plot of eleven problems or a
 * week of submissions is legible in a column and not much more than legible. The dialog is
 * the same card's contents at the width of the window, which is also what somebody does when
 * they want to show a class or a colleague what happened.
 *
 * The children are rendered again inside the dialog rather than moved into it. Each chart
 * measures the box it is in and draws to fit, so the second copy simply comes out bigger;
 * nothing is mounted until the dialog is opened.
 */
export function StatCard({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description: string;
  className?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle aria-level={3} className="text-base">
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <ExpandButton title={title} onClick={() => setExpanded(true)} />
        </CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
      <ExpandedChart
        title={title}
        description={description}
        open={expanded}
        onOpenChange={setExpanded}
      >
        {children}
      </ExpandedChart>
    </Card>
  );
}

/** The control that opens one. Named for its card, so a screen reader hears which. */
export function ExpandButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-muted-foreground size-7"
      aria-label={`View ${title} full screen`}
      onClick={onClick}
    >
      <Maximize2 className="size-4" aria-hidden="true" />
    </Button>
  );
}

/** The same chart, at the size of the window. */
export function ExpandedChart({
  title,
  description,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wider and taller than the default dialog, because the point of it is the size. The
          body scrolls on its own so a long list of problems cannot push the heading off. */}
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-[95vw] gap-4 sm:max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div tabIndex={0} className="max-h-[75vh] overflow-auto">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EmptyChart({ message }: { message: string }) {
  return (
    <div className="text-muted-foreground flex min-h-[8rem] flex-col items-center justify-center gap-1 text-center text-sm">
      <p>{message}</p>
    </div>
  );
}
