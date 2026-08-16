'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { showToast } from '@/lib/toast';

type CourseChoice = { id: string; name: string; code: string; semester: string };

/**
 * Choosing which AFCT course an LMS course opens.
 *
 * Asked once, on the first launch, and remembered. Radio buttons rather than a dropdown: this
 * is a decision that sticks, and seeing the whole list beats discovering it one item at a time.
 */
export default function LinkCourseClient({
  pendingId,
  contextTitle,
  courses = [],
  notReady = false,
}: {
  pendingId?: string;
  contextTitle?: string | null;
  courses?: CourseChoice[];
  notReady?: boolean;
}) {
  /**
   * Preselected when there is only one course, which is the common case: most faculty run one
   * course per LMS course. Asking somebody to choose from a list of one reads as a puzzle.
   */
  const [selected, setSelected] = useState<string>(
    courses.length === 1 ? (courses[0]?.id ?? '') : '',
  );
  const [saving, setSaving] = useState(false);

  const link = async () => {
    if (!selected) {
      showToast.error('Choose a course first.');
      return;
    }
    if (!pendingId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/lti/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingId, courseId: selected }),
      });
      const data = (await res.json().catch(() => ({}))) as { courseId?: string; error?: string };
      if (!res.ok) {
        showToast.error(data.error ?? 'Could not link that course. Try again.');
        setSaving(false);
        return;
      }
      // Deliberately leaves the button disabled: the browser is on its way to the course, and
      // re-enabling it invites a second click that would fail as already-linked.
      window.location.replace(`/dashboard/courses/${data.courseId}`);
    } catch {
      showToast.error('Could not link that course. Try again.');
      setSaving(false);
    }
  };

  return (
    // Centred in whatever space it is given, and with no fixed top margin: this page is
    // reached from an LMS, where the frame can be a few hundred pixels tall. The card scrolls
    // inside itself so a long list never puts its own top out of reach.
    <main className="flex min-h-dvh w-full items-center justify-center p-4">
      <Card className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto p-4">
        <CardHeader className="pb-2">
          <CardTitle role="heading" aria-level={1} className="text-xl">
            {notReady ? 'This course is not ready yet' : 'Which course is this?'}
          </CardTitle>
        </CardHeader>

        <CardContent>
          {notReady ? (
            <p className="text-muted-foreground text-sm">
              Your instructor has not finished connecting this course to AFCT. Try again later, or
              let them know you saw this.
            </p>
          ) : courses.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              You do not run any courses in AFCT yet, so there is nothing to connect this to. Create
              the course first, then open this link again from your LMS.
            </p>
          ) : (
            <>
              <p className="text-muted-foreground mb-4 text-sm">
                {contextTitle
                  ? `Choose the AFCT course that "${contextTitle}" should open. `
                  : 'Choose the AFCT course this should open. '}
                You are only asked once.
              </p>

              <fieldset className="space-y-2">
                <legend className="sr-only">AFCT courses you teach</legend>
                {courses.map((course) => (
                  <label
                    key={course.id}
                    className="hover:bg-muted flex cursor-pointer items-start gap-3 rounded-md border p-3"
                  >
                    <input
                      type="radio"
                      name="course"
                      value={course.id}
                      checked={selected === course.id}
                      onChange={() => setSelected(course.id)}
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{course.name}</span>
                      <span className="text-muted-foreground block text-xs">
                        {course.code}, {course.semester}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {/*
               * Left enabled with nothing chosen, deliberately. A disabled button that does
               * nothing when clicked gives no reason and no way forward; this says what is
               * missing. Only `saving` disables it, to stop a double submit.
               */}
              <Button className="mt-4" onClick={link} disabled={saving}>
                {saving ? 'Connecting...' : 'Connect this course'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
