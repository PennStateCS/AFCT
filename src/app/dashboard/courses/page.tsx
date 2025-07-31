'use client';

import { useEffect, useState } from 'react';
import { Course } from '@prisma/client';
import { columns } from './columns';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { CreateCourseDialog } from '@/components/dialogs/CreateCourseDialog';

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

export default function ViewCoursesPage() {
  const [courses, setCourses] = useState<CourseWithRoster[]>([]);
  const [open, setOpen] = useState(false);

  const fetchCourses = async () => {
    const res = await fetch('/api/courses');
    const data: CourseWithRoster[] = await res.json();
    setCourses(data);
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  return (
    <Card className="p-4">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-2xl">Courses</CardTitle>
        <Button onClick={() => setOpen(true)}>Create Course</Button>
      </CardHeader>

      <CardContent>
        <DataTable
          columns={columns((refreshedCourse) => {
            // Update the courses state in the parent
            setCourses((prev) =>
              prev.map((c) => (c.id === refreshedCourse.id ? refreshedCourse : c)),
            );
          })}
          data={courses}
        />
      </CardContent>

      <CreateCourseDialog open={open} setOpen={setOpen} onSuccess={fetchCourses} />
    </Card>
  );
}
