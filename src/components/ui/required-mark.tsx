import { cn } from '@/lib/utils';

/**
 * The visible "this field is required" indicator, rendered next to a field's label.
 *
 * Two deliberate choices:
 *  - `aria-hidden`, because the control itself carries `aria-required`. That is how
 *    assistive tech should learn the field is required; without the pairing a screen
 *    reader either announces a bare "asterisk" or sighted users get no cue at all.
 *  - rendered as a *sibling* of the <label>, not inside it, so the label's text (and
 *    therefore the control's accessible name) stays exactly the field name.
 */
export function RequiredMark({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('ml-0.5 text-red-600', className)}>
      *
    </span>
  );
}

export default RequiredMark;
