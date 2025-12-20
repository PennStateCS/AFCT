'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { DataTable } from '@/components/ui/data-table';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { showToast } from '@/lib/toast';
import { GraduationCap, Download, TrendingUp, Users, Target, RefreshCw } from 'lucide-react';

type StudentRow = {
  id: string;
  name: string;
  email?: string | null;
  // dynamic assignment columns will be string keyed
  [key: string]: unknown;
};

type Assignment = {
  maxPoints: number;
  id: string;
  title: string;
  dueDate?: string;
};

type ApiStudent = { id: string; firstName?: string | null; lastName?: string | null; email?: string | null; avatar?: string | null };

export default function GradesCard({ courseId }: { courseId: string }) {
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [editingCell, setEditingCell] = useState<{ studentId: string; assignmentId: string } | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [savingGrades, setSavingGrades] = useState<Set<string>>(new Set());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchGrades = useCallback(async () => {
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

      setStudents(rows);
      setAssignments(a);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Fetch grades error:', err);
      showToast.error('Failed to load grades');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    fetchGrades();
  }, [fetchGrades]);

  // Add a mechanism to refresh data when component becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Page became visible, refresh data
        fetchGrades();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchGrades]);

  const handleGradeEdit = useCallback((studentId: string, assignmentId: string, currentValue: unknown) => {
    setEditingCell({ studentId, assignmentId });
    setEditingValue(currentValue === null || currentValue === undefined ? '' : String(currentValue));
  }, []);

  const handleGradeSave = useCallback(async (studentId: string, assignmentId: string, assignmentMaxGrade: number) => {
    const gradeKey = `${studentId}-${assignmentId}`;
    setSavingGrades(prev => new Set(prev).add(gradeKey));
    
    try {
      // Validate grade
      const numericValue = editingValue.trim() === '' ? null : Number(editingValue);
      if (numericValue !== null && (isNaN(numericValue) || numericValue < 0 || numericValue > assignmentMaxGrade)) {
        showToast.error(  `Grade must be a number between 0 and ${assignmentMaxGrade}`);
        // cleanup saving flag
        setSavingGrades(prev => {
          const newSet = new Set(prev);
          newSet.delete(gradeKey);
          return newSet;
        });
        return;
      }

      // Save to API
      const res = await fetch(`/api/courses/${courseId}/${assignmentId}/grade/${studentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade: numericValue }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.error || 'Failed to save grade');
      }

      // Update local state
      setStudents(prev => prev.map(student => 
        student.id === studentId 
          ? { ...student, [assignmentId]: numericValue }
          : student
      ));

      // Get student name for toast
      const student = students.find(s => s.id === studentId);
      const assignment = assignments.find(a => a.id === assignmentId);
      const studentName = student ? student.name : 'Student';
      const assignmentTitle = assignment ? assignment.title : 'Assignment';

      showToast.success(`Grade ${numericValue ?? 'cleared'} saved for ${studentName} - ${assignmentTitle}`);
      setEditingCell(null);
      setEditingValue('');
      
    } catch (error) {
      console.error('Grade save error:', error);
      showToast.error(error instanceof Error ? error.message : 'Failed to save grade');
    } finally {
      setSavingGrades(prev => {
        const newSet = new Set(prev);
        newSet.delete(gradeKey);
        return newSet;
      });
    }
  }, [courseId, students, assignments, editingValue]);

  const handleGradeCancel = useCallback(() => {
    setEditingCell(null);
    setEditingValue('');
  }, []);

  const exportGrades = useCallback(() => {
    // Create CSV content
    const headers = ['Student Name', 'Email', ...assignments.map(a => a.title)];
    const rows = students.map(student => [
      student.name,
      student.email || '',
      ...assignments.map(a => {
        const grade = student[a.id];
        return grade === null || grade === undefined ? '' : String(grade);
      })
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `grades-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast.success('Grades exported successfully');
  }, [students, assignments]);

  // Calculate grade statistics
  const gradeStats = useMemo(() => {
    if (assignments.length === 0 || students.length === 0) return null;

    const stats = assignments.map(assignment => {
      const grades = students
        .map(student => student[assignment.id])
        .filter((grade): grade is number => typeof grade === 'number');
      
      if (grades.length === 0) {
        return {
          assignmentId: assignment.id,
          title: assignment.title,
          average: null,
          submitted: 0,
          total: students.length
        };
      }

      const average = 100 * grades.reduce((sum, grade) => sum + grade, 0) / (grades.length * assignment.maxPoints);
      
      return {
        assignmentId: assignment.id,
        title: assignment.title,
        average: Math.round(average * 10) / 10,
        submitted: grades.length,
        total: students.length
      };
    });

    const overallGrades = students.map(student => {
      // Pair each grade with its assignment's maxPoints
      const gradePairs = assignments
        .map(assignment => {
          const grade = student[assignment.id];
          return typeof grade === 'number' ? { grade, maxPoints: assignment.maxPoints } : null;
        })
        .filter((pair): pair is { grade: number; maxPoints: number } => pair !== null);

      if (gradePairs.length === 0) return null;
      
      // Calculate the student's average as a percentage of their possible points
      const totalEarned = gradePairs.reduce((sum, pair) => sum + pair.grade, 0);
      const totalPossible = gradePairs.reduce((sum, pair) => sum + pair.maxPoints, 0);
      if (totalPossible === 0) return null;
      return (totalEarned / totalPossible) * 100;
    }).filter((avg): avg is number => avg !== null);

    const overallAverage = overallGrades.length > 0 
      ? Math.round((overallGrades.reduce((sum, avg) => sum + avg, 0) / overallGrades.length) * 10) / 10
      : null;

    return { assignmentStats: stats, overallAverage };
  }, [assignments, students]);

  const columns = useMemo<ColumnDef<StudentRow, unknown>[]>(() => {
    const cols: ColumnDef<StudentRow, unknown>[] = [
      {
        id: 'avatar',
        header: '',
        accessorKey: 'avatar',
        cell: ({ row }) => {
          const avatar = row.original.avatar as string | null | undefined;
          const initials = `${String(row.original.firstName ?? '')?.[0] ?? ''}${String(row.original.lastName ?? '')?.[0] ?? ''}`.toUpperCase();
          const avatarUrl = avatar ? `/uploads/pfps/${avatar}` : '/uploads/pfps/default-avatar.png';
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
          const studentId = row.original.id as string;
          const isEditing = editingCell?.studentId === studentId && editingCell?.assignmentId === a.id;
          const gradeKey = `${studentId}-${a.id}`;
          const isSaving = savingGrades.has(gradeKey);

          if (isEditing) {
            return (
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  max={a.maxPoints}
                  step="1.0"
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleGradeSave(studentId, a.id, a.maxPoints);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      handleGradeCancel();
                    }
                  }}
                  className="h-full w-full text-center"
                  placeholder={`0-${a.maxPoints}`}
                  autoFocus
                />
              </div>
            );
          }

          return (
            <div
              className="cursor-pointer hover:bg-neutral-300 rounded px-2 py-1 h-full w-full flex items-center justify-center"
              onClick={() => handleGradeEdit(studentId, a.id, val)}
              title="Click to edit grade"
            >
              {isSaving ? (
                <span className="text-muted-foreground">Saving...</span>
              ) : (
                <span className={val === null || val === undefined ? 'text-muted-foreground' : ''}>
                  {val === null || val === undefined ? '-' : String(val)}
                </span>
              )}
            </div>
          );
        },
        meta: { priority: 2 },
      });
    }

    return cols;
  }, [assignments, editingCell, editingValue, savingGrades, handleGradeEdit, handleGradeSave, handleGradeCancel]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-2xl">
            <GraduationCap className="h-5 w-5" />
            Grades
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchGrades}
              disabled={loading}
              className="flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportGrades}
              disabled={loading || students.length === 0}
              className="flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Grade Statistics */}
        {gradeStats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-zinc-200 rounded-lg">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-600" />
              <div>
                <div className="text-sm font-medium">Overall Average</div>
                <div className="text-lg font-bold">
                  {gradeStats.overallAverage !== null ? `${gradeStats.overallAverage}%` : 'No grades'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-green-600" />
              <div>
                <div className="text-sm font-medium">Total Students</div>
                <div className="text-lg font-bold">{students.length}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-purple-600" />
              <div>
                <div className="text-sm font-medium">Assignments</div>
                <div className="text-lg font-bold">{assignments.length}</div>
              </div>
            </div>
          </div>
        )}

        {/* Assignment Statistics */}
        {gradeStats && gradeStats.assignmentStats.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Assignment Statistics</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {gradeStats.assignmentStats.map(stat => (
                <div key={stat.assignmentId} className="p-3 border rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-medium text-sm truncate">{stat.title}</div>
                    <Badge variant="secondary" className="ml-2">
                      {stat.submitted}/{stat.total}
                    </Badge>
                  </div>
                  <div className="text-lg font-bold">
                    {stat.average !== null ? `${stat.average}%` : 'No grades'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {stat.submitted > 0 ? `${Math.round((stat.submitted / stat.total) * 100)}% submitted` : 'No submissions'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Last Updated Info */}
        {lastUpdated && (
          <div className="text-xs text-muted-foreground text-center">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </div>
        )}

        {/* Instructions */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            Click any grade cell to edit
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            Press Enter to save, Escape to cancel
          </div>
        </div>

        <DataTable columns={columns} data={students} loading={loading} />
      </CardContent>
    </Card>
  );
}
