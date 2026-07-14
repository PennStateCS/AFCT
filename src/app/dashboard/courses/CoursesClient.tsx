'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { columns } from './course-columns';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { CreateCourseDialog } from '@/components/dialogs/CreateCourseDialog';
import { BookPlus } from 'lucide-react';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { apiPaths } from '@/lib/api-paths';
import type { CourseListItem } from '@/lib/courses-list';

type CourseWithRoster = CourseListItem;

/** Cache key for the courses list; shared so callers can invalidate consistently. */
export const coursesListQueryKey = ['courses', 'list'] as const;

export default function CoursesClient({ initialCourses }: { initialCourses: CourseWithRoster[] }) {
  const [open, setOpen] = useState(false);
  const { timezone } = useEffectiveTimezone();

  // Cached courses list: the SSR-provided list seeds the cache and is treated as
  // fresh, so navigating back to Courses is instant with no refetch on mount.
  const {
    data: courses = [],
    isLoading,
    isError,
    refetch,
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

  // Full refresh (referentially stable so table columns stay memoized).
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const columnsMemo = useMemo(() => columns(refresh, refresh, timezone), [refresh, timezone]);

  return (
    <Card className="p-4" aria-labelledby="courses-title">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle id="courses-title" role="heading" aria-level={1} className="text-2xl">
          Courses
        </CardTitle>
        <Button onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
          <BookPlus /> Create Course
        </Button>
      </CardHeader>

      <CardContent>
        {isError && (
          <div className="mb-3 flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
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
        />
      </CardContent>

      <CreateCourseDialog open={open} setOpen={setOpen} onSuccess={refresh} />
    </Card>
  );
}
