'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import { columns } from './course-columns';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { CreateCourseDialog } from '@/components/dialogs/CreateCourseDialog';
import { BookPlus } from 'lucide-react';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import type { CourseListItem } from '@/lib/courses-list';

type CourseWithRoster = CourseListItem;
type CourseWithFaculty = CourseListItem;

export default function CoursesClient({ initialCourses }: { initialCourses: CourseWithRoster[] }) {
  const [courses, setCourses] = useState<CourseWithRoster[]>(initialCourses);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const { timezone } = useEffectiveTimezone();

  const fetchCourses = useCallback(async () => {
    const requestSeq = ++requestSeqRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setLoading(true);
      setLoadError(null);
      const res = await fetch('/api/courses/list', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Failed to fetch courses');
      const data: CourseWithRoster[] = await res.json();
      if (requestSeq !== requestSeqRef.current) return;
      setCourses(data);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (requestSeq !== requestSeqRef.current) return;
      console.error('Error loading courses:', error);
      setLoadError('Failed to refresh courses. Please try again.');
    } finally {
      if (requestSeq !== requestSeqRef.current) return;
      setLoading(false);
    }
  }, []);

  const columnsMemo = useMemo(
    () =>
      columns(
        (refreshedCourse: CourseWithFaculty) => {
          setCourses((prev) =>
            prev.map((c) =>
              c.id === refreshedCourse.id
                ? { ...c, ...refreshedCourse, enrolled: refreshedCourse.enrolled ?? c.enrolled }
                : c,
            ),
          );
        },
        () => {
          void fetchCourses();
        },
        timezone,
      ),
    [setCourses, timezone, fetchCourses],
  );

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
        {loadError && (
          <div className="mb-3 flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <span>{loadError}</span>
            <Button size="sm" variant="outline" onClick={() => void fetchCourses()}>
              Retry
            </Button>
          </div>
        )}
        <DataTable
          columns={columnsMemo}
          data={courses}
          loading={loading}
          tableLabel="Courses table"
        />
      </CardContent>

      <CreateCourseDialog open={open} setOpen={setOpen} onSuccess={() => void fetchCourses()} />
    </Card>
  );
}
