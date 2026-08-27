import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * The one badge primitive. Everything badge-shaped in the app renders through this, so the
 * geometry, type and focus treatment are decided once.
 *
 * Three families of meaning, and they must not be blended:
 *
 *   status      success / warning / danger / info / neutral - the colour reports a state
 *   categorical category-<hue> - the colour only separates one identity from another
 *   metadata    secondary / outline - quiet, because the value carries no state
 *
 * Domain wrappers (StatusBadge, RoleBadge, CategoryBadge) decide which variant a concept
 * gets; they do not restate the geometry. See `lib/badge-presets` for the mappings.
 */
const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/70 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        destructive:
          'border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline: 'text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        success: 'border-badge-success-border bg-badge-success-bg text-badge-success',
        warning: 'border-badge-warning-border bg-badge-warning-bg text-badge-warning',
        danger: 'border-badge-danger-border bg-badge-danger-bg text-badge-danger',
        info: 'border-badge-info-border bg-badge-info-bg text-badge-info',
        neutral: 'border-badge-neutral-border bg-badge-neutral-bg text-badge-neutral',

        /**
         * Categorical hues. These name a colour, not a state.
         *
         * A `category-green` badge is green so that Problem can be told apart from Course at a
         * glance; it does not mean success, and `category-fuchsia` does not mean danger. The
         * label carries the meaning and the hue only separates neighbours. Keep them out of
         * anything that reports a state: that is what the five semantic variants above are
         * for, and mixing the two is how a red badge starts looking like a failure.
         *
         * Named by hue rather than by application (`category-violet`, not `role-admin`) so one
         * hue can serve Admin and Assignment without either owning it. The mapping from a
         * domain concept to a hue lives in `lib/badge-presets`.
         */
        'category-slate':
          'border-badge-category-slate-border bg-badge-category-slate-bg text-badge-category-slate',
        'category-blue':
          'border-badge-category-blue-border bg-badge-category-blue-bg text-badge-category-blue',
        'category-indigo':
          'border-badge-category-indigo-border bg-badge-category-indigo-bg text-badge-category-indigo',
        'category-violet':
          'border-badge-category-violet-border bg-badge-category-violet-bg text-badge-category-violet',
        'category-green':
          'border-badge-category-green-border bg-badge-category-green-bg text-badge-category-green',
        'category-amber':
          'border-badge-category-amber-border bg-badge-category-amber-bg text-badge-category-amber',
        'category-orange':
          'border-badge-category-orange-border bg-badge-category-orange-bg text-badge-category-orange',
        'category-fuchsia':
          'border-badge-category-fuchsia-border bg-badge-category-fuchsia-bg text-badge-category-fuchsia',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span';

  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
