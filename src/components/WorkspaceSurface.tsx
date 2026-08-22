import { cn } from '@/lib/utils';

/**
 * The white working surface behind a work page (Courses, a course).
 *
 * AFCT draws two kinds of page. An overview page (the dashboard) sits on the slate
 * canvas so its modules read as separate objects. A work page is one continuous surface
 * you do things on, so it takes the card colour and drops the border, radius and shadow
 * a Card would bring: this is the page, not an object on it.
 *
 * The negative margin is the awkward part and the reason this lives in one place.
 * `dashboard/layout.tsx` puts `p-4` on `<main>`, so a plain background inside it would
 * stop 16px short on every side and read as a rectangle floating on slate. `-m-4` bleeds
 * back through that padding and `p-4` restores it inside, which puts the surface flush
 * against the navbar's divider and the workspace edges.
 *
 * It is tied to that one value in the layout: change `p-4` there and change it here too.
 * There is no way to express "fill my parent's padding" in CSS alone.
 */
export function WorkspaceSurface({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('bg-card -m-4 flex-1 p-4', className)}>
      {children}
    </div>
  );
}
