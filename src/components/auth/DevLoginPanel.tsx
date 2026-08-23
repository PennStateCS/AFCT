'use client';

import { useState } from 'react';
import { Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** The seeded accounts, which all share one password. Development builds only. */
const TEST_LOGINS = [
  { role: 'admin', label: 'Admin' },
  { role: 'faculty', label: 'Faculty' },
  { role: 'ta', label: 'TA' },
  { role: 'student', label: 'Student' },
];

/**
 * Quick sign-in shortcuts for the seeded roles.
 *
 * Rendered only where `process.env.NODE_ENV !== 'production'`, and by the caller rather than
 * here, so a production build contains no markup for it at all: this is not something hidden
 * with CSS. The four accounts and their shared password are development fixtures, and they
 * must never reach a real deployment's HTML.
 *
 * One shared button style. The roles used to be four different colours, which read as a legend
 * for something; nothing here depends on telling them apart by colour, only by their label.
 */
export function DevLoginPanel({
  onSelect,
  className,
}: {
  onSelect: (role: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className={cn('bg-card rounded-xl border p-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-primary flex items-center gap-2 text-sm font-semibold">
            <Wrench className="size-4" aria-hidden="true" />
            Development build
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            These shortcuts fill the form with a seeded account. They exist only in a development
            build.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="dev-test-logins"
          className="text-link hover:text-link-hover h-10 shrink-0 px-2 text-sm underline decoration-1 underline-offset-2"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      <div id="dev-test-logins" hidden={!open} className="mt-3">
        <p className="text-muted-foreground mb-2 text-xs font-semibold">Test logins</p>
        <div className="grid grid-cols-2 gap-2">
          {TEST_LOGINS.map(({ role, label }) => (
            <Button
              key={role}
              type="button"
              variant="outline"
              className="h-11 w-full"
              onClick={() => onSelect(role)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default DevLoginPanel;
