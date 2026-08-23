'use client';

import { useState } from 'react';
import { Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** The seeded accounts, which all share one password. Development builds only. */
const TEST_LOGIN_ROLES = [
  { role: 'admin', label: 'Admin' },
  { role: 'faculty', label: 'Faculty' },
  { role: 'ta', label: 'TA' },
  { role: 'student', label: 'Student' },
] as const;

/**
 * Quick sign-in shortcuts for the seeded roles, as one quiet strip under the form.
 *
 * Rendered only where `process.env.NODE_ENV !== 'production'`, and by the caller rather than
 * here, so a production build contains no markup for it at all: this is not something hidden
 * with CSS. The four accounts and their shared password are development fixtures, and they
 * must never reach a real deployment's HTML.
 *
 * Deliberately unexplained. It said what it was for in two sentences, which made a debugging
 * aid taller than it was useful and gave it the weight of a second card next to the one people
 * are actually here to use. Four buttons under the words "Development build" need no caption.
 *
 * One button treatment for all four roles. They used to be four different colours, which reads
 * as a legend for something; nothing here depends on telling them apart by anything but their
 * label.
 */
export function DevLoginToolbar({
  onSelectRole,
  className,
}: {
  onSelectRole: (role: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className={cn('bg-card rounded-xl border p-3 sm:px-3 sm:py-2', className)}>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Wrench className="text-primary size-4" aria-hidden="true" />
          Development build
        </span>

        {/* Reached before the buttons it controls, at every width, which is the one thing that
            stays constant here: on a phone it sits beside the label on the first row, and from
            sm it moves to the far end of the strip. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="dev-test-logins"
          className="text-muted-foreground hover:text-foreground ml-auto sm:order-last"
        >
          {open ? 'Hide' : 'Show'}
        </Button>

        <span aria-hidden="true" className="bg-border hidden h-6 w-px sm:block" />

        <div
          id="dev-test-logins"
          hidden={!open}
          // Full width below sm so the four roles wrap onto their own row as a pair of columns;
          // side by side with everything else from sm, where the strip is one line.
          className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center"
        >
          {TEST_LOGIN_ROLES.map(({ role, label }) => (
            <Button
              key={role}
              type="button"
              variant="outline"
              // Comfortable to tap on a phone, compact on a desktop where it is a debugging aid
              // sitting under the real form.
              className="h-11 px-3 sm:h-8"
              onClick={() => onSelectRole(role)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default DevLoginToolbar;
