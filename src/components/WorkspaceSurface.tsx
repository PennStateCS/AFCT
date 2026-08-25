import { cn } from '@/lib/utils';

/**
 * The working surface behind a work page (Courses, a course).
 *
 * Every dashboard page now sits on the same slate canvas the dashboard overview uses, so
 * the background does not change as you move between them. This used to paint `bg-card`,
 * which made a work page one continuous white sheet and the overview slate: two pages in
 * the same app with two different grounds. The cards, tables and panels on top are still
 * `bg-card`, so they keep reading as objects on the canvas rather than dissolving into it.
 *
 * The negative margin is the awkward part and the reason this lives in one place.
 * `dashboard/layout.tsx` puts `px-4 py-6 lg:px-6` on `<main>`, so a plain background
 * inside it would stop short on every side and read as a rectangle floating on slate.
 * The negative margins bleed back through that padding and the matching padding restores
 * it inside, which puts the surface flush against the navbar's divider and the workspace
 * edges.
 *
 * It is tied to those values in the layout: change the gutter there and change it here
 * too, including the wider `lg` one.
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
    <div className={cn('bg-background -mx-4 -my-6 flex-1 px-4 py-6 lg:-mx-6 lg:px-6', className)}>
      {children}
    </div>
  );
}
