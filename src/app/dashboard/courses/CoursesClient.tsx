'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { columns } from './course-columns';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
// On demand: the create wizard carries the form stack and is not open on arrival.
const CreateCourseDialog = dynamic(
  () => import('@/components/dialogs/CreateCourseDialog').then((m) => m.CreateCourseDialog),
  { ssr: false },
);
/** True once `open` has first been true, so a dynamic import stays deferred until first use. */
function useMountedOnce(open: boolean): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return mounted || open;
}
import { BookPlus, BookOpen } from 'lucide-react';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { apiPaths } from '@/lib/api-paths';
import type { CourseListItem } from '@/lib/courses-list';

type CourseWithRoster = CourseListItem;

/** Cache key for the courses list; shared so callers can invalidate consistently. */
export const coursesListQueryKey = ['courses', 'list'] as const;

export default function CoursesClient({ initialCourses }: { initialCourses: CourseWithRoster[] }) {
  const [open, setOpen] = useState(false);
  const createMounted = useMountedOnce(open);
  const { timezone } = useEffectiveTimezone();

  // Cached courses list: the SSR-provided list seeds the cache and is treated as
  // fresh, so navigating back to Courses is instant with no refetch on mount.
  const queryClient = useQueryClient();
  const {
    data: courses = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: coursesListQueryKey,
    queryFn: async () => {
      const res = await fetch(apiPaths.myCourses(), { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch courses');
      const all = (await res.json()) as CourseWithRoster[];
      // Archived courses are shown on the Archived Courses page, not here.
      return all.filter((c) => !c.isArchived);
    },
    initialData: initialCourses,
    staleTime: 30_000,
  });

  // Full refresh (referentially stable so table columns stay memoized). Creating,
  // archiving, restoring or deleting a course moves it between the active list, the
  // archived list and the sidebar nav, so invalidate the whole ['courses'] prefix rather
  // than only this table's own query -- the sidebar used to keep showing the stale set.
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['courses'] });
  }, [queryClient]);

  const columnsMemo = useMemo(() => columns(refresh, refresh, timezone), [refresh, timezone]);

  return (
    <Card className="p-4" aria-labelledby="courses-title">
      <CardHeader className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle id="courses-title" role="heading" aria-level={1} className="text-2xl">
          Courses
        </CardTitle>
        <Button onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
          <BookPlus /> Create Course
        </Button>
      </CardHeader>

      <CardContent>
        {isError && (
          <div className="mb-3 flex items-center justify-between rounded-md border border-status-danger-border bg-status-danger-bg p-3 text-sm text-status-danger">
            <span>Failed to refresh courses. Please try again.</span>
            <Button size="sm" variant="outline" onClick={refresh}>
              Retry
            </Button>
          </div>
        )}
        <DataTable
          columns={columnsMemo}
          data={courses}
          loading={isLoading}
          tableLabel="Courses table"
          defaultSorting={[{ id: 'startDate', desc: false }]}
          emptyTitle="No courses yet"
          emptyDescription="Create a course to get started."
          emptyIcon={BookOpen}
          loadingMessage="Loading courses, please wait..."
          emptyAction={
            <Button onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
              <BookPlus /> Create Course
            </Button>
          }
        />
      </CardContent>

      {createMounted && <CreateCourseDialog open={open} setOpen={setOpen} onSuccess={refresh} />}
    </Card>
  );
}
