import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        // Cobalt. Pair --primary with --primary-foreground and nothing else: this used to
        // read --secondary-foreground, which merely happened to be the same near-white.
        // When --secondary became a pale neutral its foreground went dark, and every place
        // still relying on that coincidence turned into dark text on a cobalt fill.
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive:
          'bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        success:
          'bg-status-success-solid text-white shadow-xs hover:bg-status-success-solid/90 focus-visible:ring-status-success-solid/30',
        // border-input, not border-border. The theme now splits the two on purpose:
        // border-border is structure (a card edge, a divider) and border-input is the edge
        // of something you operate. An outline button is the second kind, and at
        // border-border it was 1.27:1 on the card in light, which is barely a boundary.
        outline:
          'border-input bg-card text-foreground border shadow-xs hover:bg-accent hover:text-accent-foreground',
        // --muted rather than --secondary. --secondary is neutral now too, so the two
        // would look alike; this keeps the button a shade quieter than a secondary
        // surface. The dark hover is spelled out because --muted and --accent are the
        // same value there, which would leave the button inert on hover.
        secondary: 'bg-muted text-foreground shadow-xs hover:bg-accent dark:hover:bg-accent/60',
        ghost:
          'text-foreground hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        // text-link, not text-primary: primary is the colour a button is PAINTED, and as
        // text on the dark card it is 3.45:1. The `menu` variant that used to sit above
        // this one is gone with --tertiary; it had no call sites.
        //
        // Underlined at rest, matching TEXT_LINK_CLASS in lib/link-styles: this variant
        // exists to look like a hyperlink, so it needs a hyperlink's non-colour cue. The
        // offset is 4 rather than the 2 that inline text links use, because this sits in a
        // button's own box on its own line and has the room. See the note in that file for
        // why colour cannot carry this alone.
        link: 'text-link underline decoration-1 underline-offset-4 hover:text-link-hover',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
