import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiPaths } from '@/lib/api-paths';

export type StudentOption = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
};

/** Full display name for a student, falling back to email. */
export function getStudentName(student: StudentOption): string {
  return (
    `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() || student.email || 'Unknown student'
  );
}

/**
 * Loads the course's enrolled students (role STUDENT), for the assignment wizard's
 * per-student override picker. Fires only while the dialog is open; a load failure
 * surfaces as a toast.
 */
export function useRosterStudentOptions(courseId: string, open: boolean): StudentOption[] {
  const query = useQuery({
    queryKey: ['course', courseId, 'students'],
    queryFn: async () => {
      const res = await fetch(apiPaths.courseStudents(courseId));
      if (!res.ok) throw new Error('Failed to load students');
      const data = await res.json();
      return (Array.isArray(data) ? data : []) as StudentOption[];
    },
    enabled: open && !!courseId,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (query.isError) toast.error('Failed to load the student list.');
  }, [query.isError]);

  return query.data ?? [];
}
