'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { cn } from '@/lib/utils';
import { courseColor } from './course-colors';
import { Checkbox } from '@/components/ui/checkbox';

export type FilterCourse = { id: string; code: string; semester?: string };

// Below this the bulk controls are busywork: with three courses, unchecking them one at
// a time is the same number of clicks as "Hide all" and nobody has to find the control.
const BULK_CONTROLS_MIN_COURSES = 4;

/**
 * A checkbox list of the viewer's courses that filters which courses' assignments
 * show on the calendar (and the Deadlines list). Checked means shown, and everything
 * starts checked. The parent tracks which courses are turned OFF
 * (`uncheckedCourseIds`), so a course that isn't in the set yet defaults to visible.
 */
export function CalendarCourseFilter({
  courses,
  uncheckedCourseIds,
  onToggle,
  onShowAll,
  onHideAll,
}: {
  courses: FilterCourse[];
  uncheckedCourseIds: Set<string>;
  onToggle: (courseId: string) => void;
  onShowAll?: () => void;
  onHideAll?: () => void;
}) {
  // Nothing to filter with fewer than two courses; the box would just be noise.
  if (courses.length < 2) return null;

  const showBulk = courses.length >= BULK_CONTROLS_MIN_COURSES && (onShowAll || onHideAll);
  const allShown = courses.every((c) => !uncheckedCourseIds.has(c.id));
  const allHidden = courses.every((c) => uncheckedCourseIds.has(c.id));

  return (
    // Compact like the dashboard rail modules: the card's default py-6 plus a header
    // gap-6 spent most of this box on air, and it sits beside a dense month grid.
    <Card className="gap-0 py-4">
      <CardHeader className="px-4 pb-2">
        <CardTitle className="text-base">Courses</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <fieldset>
          <legend className="text-muted-foreground mb-2 text-sm">
            Show assignments for these courses
          </legend>
          <ul className="max-h-64 space-y-0.5 overflow-y-auto">
            {courses.map((c) => {
              const checked = !uncheckedCourseIds.has(c.id);
              return (
                <li key={c.id}>
                  <label className="hover:bg-muted flex items-start gap-2 rounded px-1 py-1 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => onToggle(c.id)}
                      aria-label={`Show assignments for ${c.code}${c.semester ? `, ${c.semester}` : ''}`}
                      className="mt-0.5 shrink-0"
                    />
                    {/* The same colour this course's chips carry on the grid. Decorative
                        and aria-hidden: the code beside it is what identifies the course,
                        so nothing here depends on telling the hues apart. */}
                    <span
                      aria-hidden="true"
                      className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', courseColor(c.id).dot)}
                    />
                    {/* Just the code plus the semester keeps rows short (course names can
                        be long) while still telling two offerings of the same course apart
                        across terms. Long labels wrap rather than clip; the checkbox stays
                        top-aligned. */}
                    <span className="min-w-0 flex-1 break-words">
                      <span className="font-medium">{c.code}</span>
                      {c.semester ? (
                        <span className="text-muted-foreground"> &middot; {c.semester}</span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {/* Utility actions, not calls to action: ghost, small, and disabled once they
              would do nothing. The list above is still the primary control. */}
          {showBulk ? (
            <div className="border-border mt-2 flex items-center gap-1 border-t pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={onShowAll}
                disabled={allShown}
              >
                Show all
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={onHideAll}
                disabled={allHidden}
              >
                Hide all
              </Button>
            </div>
          ) : null}
        </fieldset>
      </CardContent>
    </Card>
  );
}
