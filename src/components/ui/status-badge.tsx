import { Badge } from '@/components/ui/badge';
import type { StatusChip } from '@/lib/submission-status';

/**
 * A submission status chip rendered as a tinted badge, e.g. Correct, Late, Pending.
 *
 * The colour comes from the chip's own `variant`, so the label and its colour are decided
 * in one place (`lib/submission-status`) rather than per table. `title` carries the longer
 * explanation on hover; the visible label is the accessible name, so nothing is announced
 * twice.
 */
export function StatusBadge({ chip, className }: { chip: StatusChip; className?: string }) {
  return (
    <Badge variant={chip.variant} title={chip.title} className={className}>
      {chip.label}
    </Badge>
  );
}
