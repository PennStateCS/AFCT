'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '@/components/ui/data-table';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { showToast } from '@/lib/toast';
import { GraduationCap } from 'lucide-react';

type StudentRow = {
  id: string;
  name: string;
  email?: string | null;
  // dynamic assignment columns will be string keyed
  [key: string]: unknown;
};

type Assignment = {
  id: string;
  title: string;
  dueDate?: string;
};

type ApiStudent = { id: string; firstName?: string | null; lastName?: string | null; email?: string | null; avatar?: string | null };

export default function GradesCard({ courseId }: { courseId: string }) {
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  useEffect(() => {
    let mounted = true;
    async function fetchGrades() {
      setLoading(true);
      try {
        const res = await fetch(`/api/courses/${courseId}/grades`);
        if (!res.ok) throw new Error((await res.json())?.error || 'Failed to load grades');
        const body = await res.json();

        const { students: s, assignments: a, grades } = body as { students: ApiStudent[]; assignments: Assignment[]; grades: Record<string, Record<string, number | null>> };

        // Build rows
        const rows: StudentRow[] = s.map((stu) => {
          const name = [stu.firstName, stu.lastName].filter(Boolean).join(' ') || stu.email || 'Unknown';
          const row: StudentRow = { id: stu.id, name, email: stu.email, avatar: stu.avatar ?? null, firstName: stu.firstName ?? '', lastName: stu.lastName ?? '' };
          for (const asg of a) {
            const grade = grades?.[stu.id]?.[asg.id];
            row[asg.id] = grade ?? null;
          }
          return row;
        });

        if (!mounted) return;
        setStudents(rows);
        setAssignments(a);
      } catch (err) {
        console.error(err);
        showToast.error('Failed to load grades');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchGrades();
    return () => {
      mounted = false;
    };
  }, [courseId]);

  const columns = useMemo<ColumnDef<StudentRow, unknown>[]>(() => {
    const cols: ColumnDef<StudentRow, unknown>[] = [
      {
        id: 'avatar',
        header: '',
        accessorKey: 'avatar',
        cell: ({ row }) => {
          const avatar = row.original.avatar as string | null | undefined;
          const initials = `${String(row.original.firstName ?? '')?.[0] ?? ''}${String(row.original.lastName ?? '')?.[0] ?? ''}`.toUpperCase();
          const avatarUrl = avatar ? `/uploads/${avatar}` : undefined;
          return (
            <Avatar className="h-10 w-10">
              <AvatarImage src={avatarUrl} alt={String(row.original.firstName ?? '') + ' ' + String(row.original.lastName ?? '')} />
              <AvatarFallback className="bg-secondary text-secondary-foreground">{initials || 'U'}</AvatarFallback>
            </Avatar>
          );
        },
        meta: { priority: 1 },
      },
      {
        accessorKey: 'firstName',
        header: 'First Name',
        cell: ({ row }) => <div>{String(row.original.firstName ?? '')}</div>,
        meta: { priority: 1 },
      },
      {
        accessorKey: 'lastName',
        header: 'Last Name',
        cell: ({ row }) => <div>{String(row.original.lastName ?? '')}</div>,
        meta: { priority: 1 },
      },
    ];

    for (const a of assignments) {
      cols.push({
        id: a.id,
        accessorKey: a.id,
        header: a.title,
        cell: ({ row }) => {
          const val = row.original[a.id];
          return <div>{val === null || val === undefined ? '-' : String(val)}</div>;
        },
        meta: { priority: 2 },
      });
    }

    return cols;
  }, [assignments]);

  return (
    <Card>
      <CardHeader>
       
        <CardTitle className="flex items-center gap-2 text-2xl"> <GraduationCap className="h-5 w-5" />Grades</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable columns={columns} data={students} loading={loading} />
      </CardContent>
    </Card>
  );
}
