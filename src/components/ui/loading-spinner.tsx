'use client';

import Spinner from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

type Props = {
  label?: string;
  fullScreen?: boolean;
  className?: string;
};

/**
 * A centred wait, for a page or a section that has nothing to show yet.
 *
 * The animation itself comes from [Spinner], which is also what a data table uses, so a page and
 * the table on it do not wait in two different ways.
 *
 * `cn` rather than a template string: several callers pass their own `min-h-*` to make the block
 * shorter than the default, and without merging both heights are emitted and which one wins is
 * down to the order the classes happen to sit in the stylesheet.
 */
export default function LoadingSpinner({
  label = 'Loading',
  fullScreen = true,
  className,
}: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-3',
        fullScreen ? 'min-h-screen' : 'min-h-[50vh]',
        className,
      )}
    >
      <Spinner />
      <div className="text-muted-foreground text-sm">{label}</div>
    </div>
  );
}
