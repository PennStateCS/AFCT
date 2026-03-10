'use client';

import { useState, useMemo } from 'react';
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
  const [open, setOpen] = useState(false);
  const { timezone } = useEffectiveTimezone();

  const fetchCourses = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/courses/list', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch courses');
      const data: CourseWithRoster[] = await res.json();
      setCourses(data);
    } catch (error) {
      console.error('Error loading courses:', error);
    } finally {
      setLoading(false);
    }
  };

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
          fetchCourses();
        },
        timezone,
      ),
    [setCourses, timezone],
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
        <DataTable
          columns={columnsMemo}
          data={courses}
          loading={loading}
          tableLabel="Courses table"
        />
      </CardContent>

      <CreateCourseDialog open={open} setOpen={setOpen} onSuccess={fetchCourses} />
    </Card>
  );
}
