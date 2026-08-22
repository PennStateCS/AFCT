import { cn } from '@/lib/utils';

/**
 * The white working surface behind a work page (Courses, a course).
 *
 * AFCT draws two kinds of page. An overview page (the dashboard) sits on the slate
 * canvas so its modules read as separate objects. A work page is one continuous surface
 * you do things on, so it takes the card colour and drops the border, radius and shadow
 * a Card would bring: this is the page, not an object on it.
 *
 * The negative margins are the awkward part and the reason this lives in one place.
 * `dashboard/layout.tsx` puts `p-4` on the column holding the navbar AND `<main>`, so a
 * plain background inside `<main>` would stop 16px short on three sides and read as a
 * rectangle floating on slate. The margins bleed back through that padding and the
 * padding is then restored inside. `-mt-5` matches the navbar's own `mb-5`, so the
 * surface begins at the header's divider rather than 20px below it.
 *
 * If either of those two values in the layout or the navbar changes, this has to change
 * with it. There is no way to express "fill my parent's padding" in CSS alone.
 */
export function WorkspaceSurface({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('bg-card -mx-4 -mt-5 -mb-4 flex-1 px-4 pt-5 pb-4', className)}>
      {children}
    </div>
  );
}
