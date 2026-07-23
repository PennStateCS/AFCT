'use client';

import React, { useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { columns } from '../courses/course-columns';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Archive } from 'lucide-react';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { apiPaths } from '@/lib/api-paths';
import type { CourseListItem } from '@/lib/courses-list';

/** Cache key for the archived-courses list; distinct from the active list. */
export const archivedCoursesQueryKey = ['courses', 'archived'] as const;

/**
 * The Archived Courses list: the same DataTable + columns as the admin Courses
 * page, but scoped to archived courses only. Visibility is decided server-side
 * (admins see every archived course; everyone else only those they're on the
 * roster of), so this just renders and keeps the list fresh after row actions.
 */
export default function ArchivedCoursesClient({
  initialCourses,
  isAdmin,
}: {
  initialCourses: CourseListItem[];
  isAdmin: boolean;
}) {
  const { timezone } = useEffectiveTimezone();

  const queryClient = useQueryClient();
  const {
    data: courses = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: archivedCoursesQueryKey,
    queryFn: async () => {
      const res = await fetch(apiPaths.myCourses(), { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch courses');
      const all = (await res.json()) as CourseListItem[];
      // The shared list mixes active courses in; this page is archived-only.
      return all.filter((c) => c.isArchived);
    },
    initialData: initialCourses,
    staleTime: 30_000,
  });

  // Restoring or deleting moves a course between this list, the active list and the
  // sidebar nav, so invalidate the whole ['courses'] prefix rather than only this query.
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['courses'] });
  }, [queryClient]);

  const columnsMemo = useMemo(() => {
    const cols = columns(refresh, refresh, timezone);
    // The row actions (Manage: duplicate / archive / restore / delete) are admin-only here.
    return isAdmin ? cols : cols.filter((col) => col.id !== 'actions');
  }, [refresh, timezone, isAdmin]);

  return (
    <Card className="p-4" aria-labelledby="archived-courses-title">
      <CardHeader className="pb-4">
        <CardTitle
          id="archived-courses-title"
          role="heading"
          aria-level={1}
          className="text-2xl"
        >
          Archived Courses
        </CardTitle>
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
          tableLabel="Archived courses table"
          emptyTitle="No archived courses"
          emptyDescription="Courses you archive will appear here."
          emptyIcon={Archive}
        />
      </CardContent>
    </Card>
  );
}
