import { Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The seeded accounts, which all share one password. Development builds only.
 *
 * The colours are categorical, not semantic: they say "these are four different accounts",
 * and nothing here means success or danger. Green and red are left out for that reason, and
 * every fill carries white at 6.3:1 or better, hover states included.
 */
const TEST_LOGIN_ROLES = [
  {
    role: 'admin',
    label: 'Admin',
    classes: 'border-slate-800 bg-slate-800 hover:border-slate-700 hover:bg-slate-700',
  },
  {
    role: 'faculty',
    label: 'Faculty',
    classes: 'border-blue-700 bg-blue-700 hover:border-blue-600 hover:bg-blue-600',
  },
  {
    role: 'ta',
    label: 'TA',
    classes: 'border-violet-700 bg-violet-700 hover:border-violet-600 hover:bg-violet-600',
  },
  {
    role: 'student',
    label: 'Student',
    classes: 'border-indigo-700 bg-indigo-700 hover:border-indigo-600 hover:bg-indigo-600',
  },
] as const;

/**
 * Quick sign-in shortcuts for the seeded roles, as a small dock at the foot of the pane.
 *
 * Rendered only where `process.env.NODE_ENV !== 'production'`, and by the caller rather than
 * here, so a production build contains no markup for it at all: this is not something hidden
 * with CSS. The four accounts and their shared password are development fixtures, and they
 * must never reach a real deployment's HTML.
 *
 * No caption and no collapse control. It said what it was for in two sentences and offered to
 * hide itself, which is a lot of apparatus for four buttons; in a development build these are
 * always wanted, and in any other build they do not exist.
 */
export function DevLoginToolbar({
  onSelectRole,
  className,
}: {
  onSelectRole: (role: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-card w-full rounded-xl border p-3 shadow-md sm:w-auto sm:px-3 sm:py-2',
        'flex flex-col gap-3 sm:flex-row sm:items-center',
        className,
      )}
    >
      <span className="flex items-center gap-2 text-sm font-semibold">
        <Wrench className="text-primary size-4" aria-hidden="true" />
        Development build
      </span>

      <span aria-hidden="true" className="bg-border hidden h-6 w-px sm:block" />

      {/* Two columns below sm so the four roles stay comfortable to tap; one line from sm,
          where this is a debugging aid rather than something anybody uses on a phone. */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
        {TEST_LOGIN_ROLES.map(({ role, label, classes }) => (
          <Button
            key={role}
            type="button"
            variant="outline"
            className={cn('h-11 px-3 text-white hover:text-white sm:h-8', classes)}
            onClick={() => onSelectRole(role)}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export default DevLoginToolbar;
