'use client';

import { useEffect, useState } from 'react';
import { Course } from '@prisma/client';
import { columns } from './course-columns';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { CreateCourseDialog } from '@/components/dialogs/CreateCourseDialog';
import { BookPlus } from 'lucide-react';

type UserSummary = {
  id: string;
  firstName: string | null;
  lastName: string | null;
};

type CourseWithRoster = Course & {
  faculty: UserSummary[];
  tas: UserSummary[];
  students: UserSummary[];
};

type CourseWithFaculty = Course & {
  faculty: { firstName: string | null; lastName: string | null }[];
};

export default function ViewCoursesPage() {
  const [courses, setCourses] = useState<CourseWithRoster[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const fetchCourses = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/courses');
      if (!res.ok) throw new Error('Failed to fetch users');
      const data: CourseWithRoster[] = await res.json();
      setCourses(data);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  return (
    <Card className="p-4">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-2xl">Courses</CardTitle>
        <Button onClick={() => setOpen(true)}>
          <BookPlus /> Create Course
        </Button>
      </CardHeader>

      <CardContent>
        <DataTable
          columns={columns((refreshedCourse: CourseWithFaculty) => {
            setCourses((prev) =>
              prev.map((c) =>
                c.id === refreshedCourse.id ? { ...c, ...refreshedCourse, faculty: c.faculty } : c,
              ),
            );
          })}
          data={courses}
          loading={loading}
        />
      </CardContent>

      <CreateCourseDialog open={open} setOpen={setOpen} onSuccess={fetchCourses} />
    </Card>
  );
}
