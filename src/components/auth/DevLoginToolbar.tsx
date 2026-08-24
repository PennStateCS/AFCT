import { Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The seeded accounts, which all share one password. Development builds only.
 *
 * The colours are categorical, not semantic: they say "these are four different accounts",
 * and nothing here means success or danger. Green and red are left out for that reason.
 *
 * Spread by hue rather than picked one at a time. The first attempt used blue, violet and
 * indigo, and indigo sits BETWEEN the other two (264 / 277 / 293), so three of the four read
 * as the same blue. These are 260 / 264 / 302 / 324, which is about double the separation.
 * Every fill carries white at 6.3:1 or better, and at 4.7:1 or better on hover.
 *
 * Admin is the exception, and it moved from slate-800 to slate-600 when the dock went dark.
 * The dock used to be a white card, where a near-black chip was the quietest of the four;
 * against the sign-in page's navy it was within a few points of the ground behind it and read
 * as a hole rather than a button.
 */
const TEST_LOGIN_ROLES = [
  {
    role: 'admin',
    label: 'Admin',
    classes: 'border-slate-600 bg-slate-600 hover:border-slate-500 hover:bg-slate-500',
  },
  {
    role: 'faculty',
    label: 'Faculty',
    classes: 'border-blue-700 bg-blue-700 hover:border-blue-600 hover:bg-blue-600',
  },
  {
    role: 'ta',
    label: 'TA',
    classes: 'border-purple-700 bg-purple-700 hover:border-purple-600 hover:bg-purple-600',
  },
  {
    role: 'student',
    label: 'Student',
    classes: 'border-fuchsia-700 bg-fuchsia-700 hover:border-fuchsia-600 hover:bg-fuchsia-600',
  },
] as const;

/**
 * Quick sign-in shortcuts for the seeded roles, as a small dock at the foot of the pane.
 *
 * Same glass as the panel's footer on the other side of the screen: a translucent film, a
 * hairline edge and a 1px backdrop blur over the page's own ground. It was a white card, which
 * on a navy page was the brightest object on the screen and the one thing that did not belong
 * to the design; it was also sized like a form control rather than like a debugging aid, and
 * took as much vertical space as the sign-in button.
 *
 * Square across the top and rounded below, because its top edge is tucked behind the sign-in
 * card and only the bottom of it is ever seen. The bottom radius matches the card's own
 * `rounded-2xl`. The extra top padding is the tuck: eight pixels of this are behind the card,
 * so without it the label would sit too close to the card's edge.
 *
 * The caller sets the width, inset well in from the card's sides, which leaves about 356px
 * for one line. That is why the spacing is tight and why the label is "Dev build" rather than
 * the sentence it used to be: at this width the four roles are the part worth the space.
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
        'border-sidebar-foreground/[0.08] bg-sidebar-foreground/[0.035] text-sidebar-foreground',
        'w-full rounded-b-2xl border p-3 shadow-lg backdrop-blur-[1px] sm:pt-3.5 sm:pr-1.5 sm:pb-1.5 sm:pl-3.5',
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2',
        className,
      )}
    >
      <span className="flex items-center gap-2 text-xs font-medium whitespace-nowrap">
        <Wrench className="size-3.5 text-blue-400" aria-hidden="true" />
        Dev build
      </span>

      {/* Two columns below sm so the four roles stay comfortable to tap; one line from sm,
          where this is a debugging aid rather than something anybody uses on a phone. */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-1.5">
        {TEST_LOGIN_ROLES.map(({ role, label, classes }) => (
          <Button
            key={role}
            type="button"
            variant="outline"
            // Tap-sized below sm, chip-sized from sm: the four fills are what has to stay
            // legible, not the box around them.
            className={cn(
              'h-11 rounded-full px-3 text-xs text-white hover:text-white sm:h-7 sm:px-2.5',
              classes,
            )}
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
