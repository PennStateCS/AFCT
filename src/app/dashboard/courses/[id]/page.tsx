'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { CreateProblemDialog } from '@/components/dialogs/CreateProblemDialog';
import { EditProblemDialog } from '@/components/dialogs/EditProblemDialog';
import { EditCourseDialog } from '@/components/dialogs/EditCourseDialog';
import { EditAssignmentDialog } from '@/components/dialogs/EditAssignmentDialog';
import { CreateAssignmentDialog } from '@/components/dialogs/CreateAssignmentDialog';
import { EnrollUserDialog } from '@/components/dialogs/EnrollUsersDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { Course, User, Assignment, Problem, Role } from '@prisma/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable } from '@/components/ui/data-table';
import { userColumns } from './user_columns';
import { useAssignmentColumns } from './useAssignmentColumns';
import { problemColumns } from './problem_columns';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Plus, Pencil } from 'lucide-react';

// Assignment with problem count as returned by API
type AssignmentWithProblemCount = Assignment & {
  problemCount: number;
};

type FullCourse = Course & {
  faculty: User[];
  tas: User[];
  students: User[];
  assignments: AssignmentWithProblemCount[];
  problems: Problem[];
};

type DeleteTarget = {
  id: string;
  type: 'problem' | 'assignment';
};

export default function AdminCoursePage() {
  const { id } = useParams();
  const [course, setCourse] = useState<FullCourse | null>(null);

  // Edit course dialog
  const [editOpen, setEditOpen] = useState(false);

  // Problem dialog
  const [problemOpen, setProblemOpen] = useState(false);
  const [editProblemOpen, setEditProblemOpen] = useState(false);
  const [selectedProblem, setSelectedProblem] = useState<Problem | null>(null);

  // Assignment create/edit dialog state
  const [editAssignmentOpen, setEditAssignmentOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [createAssignmentOpen, setCreateAssignmentOpen] = useState(false);

  // Delete confirm
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null);

  // Tab logic
  const searchParams = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState(searchParams.get('tab') || 'assignments');

  // Enroll user
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [allUsers, setAllUsers] = useState<
    {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
      role: Role;
    }[]
  >([]);

  // Publish Toggle
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [pendingPublish, setPendingPublish] = useState<boolean | null>(null);

  // Filter user dataset
  const openEnrollDialog = async () => {
    try {
      const res = await fetch('/api/users'); // Adjust endpoint as needed
      if (!res.ok) throw new Error('Failed to fetch users');
      const users: User[] = await res.json();
      // Filter out already enrolled users (students, faculty, tas)
      if (course) {
        const inCourseIds = new Set([
          ...course.students.map((u) => u.id),
          ...course.faculty.map((u) => u.id),
          ...course.tas.map((u) => u.id),
        ]);
        setAllUsers(users.filter((u) => !inCourseIds.has(u.id)));
      }
      setEnrollOpen(true);
    } catch {
      toast.error('Failed to load user list');
    }
  };

  // Fetch course info
  useEffect(() => {
    fetch(`/api/courses/${id}`)
      .then((res) => res.json())
      .then((data) => {
        setCourse({
          ...data,
          faculty: data.faculty || [],
          tas: data.tas || [],
          students: data.students || [],
          assignments: data.assignments || [],
          problems: data.problems || [],
        });
      })
      .catch(() => toast.error('Failed to load course'));
  }, [id]);

  // Assignment handlers
  const handleAssignmentEditClick = useCallback((assignment: Assignment) => {
    setSelectedAssignment(assignment);
    setEditAssignmentOpen(true);
  }, []);

  const handleAssignmentDeleteClick = useCallback((assignmentId: string) => {
    setPendingDelete({ id: assignmentId, type: 'assignment' });
    setConfirmOpen(true);
  }, []);

  // Problem delete handler
  const handleProblemDeleteClick = useCallback((problemId: string) => {
    setPendingDelete({ id: problemId, type: 'problem' });
    setConfirmOpen(true);
  }, []);

  const handleProblemEditClick = useCallback((problem: Problem) => {
    setSelectedProblem(problem);
    setEditProblemOpen(true);
  }, []);

  // Actually delete assignment or problem and update UI
  const handleDelete = useCallback(async (target: DeleteTarget) => {
    try {
      if (target.type === 'assignment') {
        const res = await fetch(`/api/assignments/${target.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete assignment');
        setCourse((prev) =>
          prev
            ? { ...prev, assignments: prev.assignments.filter((a) => a.id !== target.id) }
            : prev,
        );
        toast.success('Assignment deleted');
      } else if (target.type === 'problem') {
        const res = await fetch(`/api/problems/${target.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete problem');
        setCourse((prev) =>
          prev ? { ...prev, problems: prev.problems.filter((p) => p.id !== target.id) } : prev,
        );
        toast.success('Problem deleted');
      }
    } catch (err) {
      toast.error('Error deleting item');
      console.error(err);
    } finally {
      setConfirmOpen(false);
      setPendingDelete(null);
    }
  }, []);

  const handleEnrollUser = async (user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: Role;
  }) => {
    try {
      const res = await fetch(`/api/courses/${id}/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!res.ok) throw new Error('Failed to enroll user');
      toast.success('User enrolled!');
      // Refresh course data
      fetch(`/api/courses/${id}`)
        .then((res) => res.json())
        .then(setCourse)
        .catch(() => toast.error('Failed to reload course data'));
    } catch {
      toast.error('Error enrolling user');
    }
  };

  const handleConfirm = useCallback(() => {
    if (pendingDelete) handleDelete(pendingDelete);
  }, [pendingDelete, handleDelete]);

  const handleCancel = useCallback(() => {
    setPendingDelete(null);
    setConfirmOpen(false);
  }, []);

  // Tab switching, updates URL params
  const handleTabChange = useCallback(
    (value: string) => {
      setTab(value);
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', value);
      router.replace(`?${params.toString()}`);
    },
    [searchParams, router],
  );

  // Assignment edit handler
  const handleAssignmentSave = useCallback(async (updatedAssignment: Assignment) => {
    setCourse((prev) =>
      prev
        ? {
            ...prev,
            assignments: prev.assignments.map((a) =>
              a.id === updatedAssignment.id
                ? { ...updatedAssignment, problemCount: a.problemCount }
                : a,
            ),
          }
        : prev,
    );
    setEditAssignmentOpen(false);
    setSelectedAssignment(null);
    toast.success('Assignment updated!');
  }, []);

  const assignmentColumns = useAssignmentColumns(
    handleAssignmentDeleteClick,
    handleAssignmentEditClick,
  );

  const problemCols = useMemo(
    () => problemColumns({ onEdit: handleProblemEditClick, onDelete: handleProblemDeleteClick }),
    [handleProblemEditClick, handleProblemDeleteClick],
  );

  if (!course) return <div className="p-6">Loading course...</div>;

  return (
    <div className="space-y-6 p-0">
      {/* --- COURSE CARD --- */}
      <Card>
        <CardHeader className="flex items-start justify-between">
          <div>
            <CardTitle className="text-2xl">
              {course.code}: {course.name}
            </CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">
              {course.semester} • {course.credits} credits •{' '}
              {new Date(course.startDate).toLocaleDateString()} -{' '}
              {new Date(course.endDate).toLocaleDateString()}
            </p>
          </div>
          <Button variant="default" onClick={() => setEditOpen(true)} className="shrink-0">
            <Pencil /> Edit Course
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Published:</span>
            <Switch
              checked={course.isPublished}
              onCheckedChange={(checked) => {
                setPendingPublish(checked);
                setPublishConfirmOpen(true);
              }}
            />
          </div>
          <div>
            <span className="font-semibold">Registration Code: </span>
            <span className="text-muted-foreground">
              {course.regCode
                ? `${course.regCode.toUpperCase().slice(0, 3)}-${course.regCode.toUpperCase().slice(3)}`
                : 'Not set'}
            </span>
          </div>
          <div>
            <span className="font-semibold">Faculty: </span>
            <span className="text-muted-foreground">
              {course.faculty.length > 0
                ? course.faculty
                    .map((f) => `${f.firstName ?? ''} ${f.lastName ?? ''}`.trim())
                    .join(', ')
                : 'None assigned'}
            </span>
          </div>
          <div>
            <span className="font-semibold">Teaching Assistants: </span>
            <span className="text-muted-foreground">
              {course.tas.length > 0
                ? course.tas
                    .map((ta) => `${ta.firstName ?? ''} ${ta.lastName ?? ''}`.trim())
                    .join(', ')
                : 'None assigned'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* --- MAIN TABS --- */}
      <Tabs defaultValue="assignments" value={tab} onValueChange={handleTabChange}>
        <TabsList className="bg-card border-border h-12 rounded-md border p-1 shadow-sm">
          <TabsTrigger
            className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white"
            value="assignments"
          >
            📄 Assignments
          </TabsTrigger>
          <TabsTrigger
            className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white"
            value="problems"
          >
            🧠 Problems
          </TabsTrigger>
          <TabsTrigger
            className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white"
            value="roster"
          >
            📜 Roster
          </TabsTrigger>
          <TabsTrigger
            className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white"
            value="grades"
          >
            🎓 Grades
          </TabsTrigger>
          <TabsTrigger
            className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white"
            value="activity"
          >
            📈 Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="assignments"
          className="animate-fade-in-up transition-opacity duration-300"
        >
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-2xl">Assignments</CardTitle>
              <Button
                style={{
                  backgroundColor: 'var(--color-primary)',
                  color: 'var(--color-primary-foreground)',
                }}
                onClick={() => setCreateAssignmentOpen(true)}
              >
                <Plus /> Create Assignment
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {course.assignments.length ? (
                <DataTable columns={assignmentColumns} data={course.assignments} />
              ) : (
                <p className="text-muted-foreground italic">No assignments found.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent
          value="problems"
          className="animate-fade-in-up transition-opacity duration-300"
        >
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-2xl">Problems</CardTitle>
              <Button variant="default" onClick={() => setProblemOpen(true)}>
                <Plus /> Create Problem
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {course.problems.length ? (
                <DataTable columns={problemCols} data={course.problems} />
              ) : (
                <p className="text-muted-foreground italic">No problems added.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roster" className="animate-fade-in-up transition-opacity duration-300">
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-2xl">Course Roster</CardTitle>
                <Button variant="default" onClick={openEnrollDialog}>
                  <Plus /> Enroll User
                </Button>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={userColumns(() => {
                    // Optional callback to refresh course after edit/delete
                    fetch(`/api/courses/${id}`)
                      .then((res) => res.json())
                      .then(setCourse);
                  })}
                  data={[
                    ...course.faculty.map((u) => ({ ...u, _role: 'Faculty' })),
                    ...course.tas.map((u) => ({ ...u, _role: 'TA' })),
                    ...course.students.map((u) => ({ ...u, _role: 'Student' })),
                  ]}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="grades" className="animate-fade-in-up transition-opacity duration-300">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">Grades</CardTitle>
              </CardHeader>
              <CardContent>To Do...</CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent
          value="activity"
          className="animate-fade-in-up transition-opacity duration-300"
        >
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">Activity</CardTitle>
              </CardHeader>
              <CardContent>To Do...</CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* --- DIALOGS --- */}
      <EditCourseDialog
        course={course}
        open={editOpen}
        setOpen={setEditOpen}
        onSave={async (updatedCourse) => {
          try {
            const res = await fetch(`/api/courses/${updatedCourse.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updatedCourse),
            });
            if (!res.ok) throw new Error('Failed to save course');
            const updated = await res.json();
            setCourse((prev) => (prev ? { ...prev, ...updated } : prev));
            toast.success('Course updated!');
          } catch {
            toast.error('Failed to save course');
          }
          setEditOpen(false);
        }}
      />

      {course && (
        <CreateProblemDialog
          open={problemOpen}
          setOpen={setProblemOpen}
          courseId={course.id}
          onCreated={(newProblem) => {
            if (newProblem) {
              setCourse((prev) =>
                prev ? { ...prev, problems: [...prev.problems, newProblem] } : prev,
              );
              toast.success('Problem created!');
            }
          }}
        />
      )}

      {selectedAssignment && (
        <EditAssignmentDialog
          assignment={selectedAssignment}
          open={editAssignmentOpen}
          setOpen={setEditAssignmentOpen}
          onSave={handleAssignmentSave}
        />
      )}

      {selectedProblem && (
        <EditProblemDialog
          problem={selectedProblem}
          open={editProblemOpen}
          setOpen={(val) => {
            setEditProblemOpen(val);
            if (!val) setSelectedProblem(null); // clear selection on close
          }}
          onSaved={(updated) => {
            if (updated) {
              setCourse((prev) =>
                prev
                  ? {
                      ...prev,
                      problems: prev.problems.map((p) => (p.id === updated.id ? updated : p)),
                    }
                  : prev,
              );
              toast.success('Problem updated!');
            }
          }}
        />
      )}

      <CreateAssignmentDialog
        open={createAssignmentOpen}
        setOpen={setCreateAssignmentOpen}
        courseId={course.id}
        onCreate={(newAssignment) => {
          setCourse((prev) =>
            prev
              ? {
                  ...prev,
                  assignments: [...prev.assignments, { ...newAssignment, problemCount: 0 }],
                }
              : prev,
          );
          toast.success('Assignment created!');
        }}
      />
      <ConfirmDialog
        open={confirmOpen}
        title={pendingDelete?.type === 'assignment' ? 'Delete Assignment?' : 'Delete Problem?'}
        description="Are you sure you want to delete this item? This cannot be undone."
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />

      <ConfirmDialog
        open={publishConfirmOpen}
        confirmText={pendingPublish ? 'Publish' : 'Unpublish'}
        title={pendingPublish ? 'Publish Course?' : 'Unpublish Course?'}
        description={
          pendingPublish
            ? 'Are you sure you want to publish this course? It will be visible to students.'
            : 'Are you sure you want to unpublish this course? Students will no longer see it.'
        }
        onConfirm={async () => {
          if (pendingPublish === null) return;

          try {
            const res = await fetch(`/api/courses/${course.id}/publish`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ isPublished: pendingPublish }),
            });
            if (!res.ok) throw new Error('Failed to update publish status');

            const updated = await res.json();
            setCourse((prev) => (prev ? { ...prev, isPublished: updated.isPublished } : prev));
            toast.success(pendingPublish ? 'Course published' : 'Course unpublished');
          } catch {
            toast.error('Error updating publish status');
          } finally {
            setPublishConfirmOpen(false);
            setPendingPublish(null);
          }
        }}
        onCancel={() => {
          setPublishConfirmOpen(false);
          setPendingPublish(null);
        }}
      />

      <EnrollUserDialog
        open={enrollOpen}
        setOpen={setEnrollOpen}
        users={allUsers}
        onEnroll={handleEnrollUser}
      />
    </div>
  );
}
