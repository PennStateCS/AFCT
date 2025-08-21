import { useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ActivityCard } from '@/components/ActivityCard';
import { AssignmentsCard } from '@/components/AssignmentsCard';
import { ProblemsCard } from '@/components/ProblemsCard';
import { RosterCard } from '@/components/RosterCard';
import { userColumns } from '@/app/dashboard/courses/[id]/user-columns';
import { useAssignmentColumns } from '@/app/dashboard/courses/[id]/assignment-columns';
import { problemColumns } from '@/app/dashboard/courses/[id]/problem-columns';
import { FullCourse, TabType } from '@/types/course';
import { Assignment, Problem } from '@prisma/client';

interface AdminCourseViewProps {
  course: FullCourse;
  tab: TabType;
  onTabChange: (value: string) => void;
  onCreateAssignment: () => void;
  onCreateProblem: () => void;
  onEnrollUser: () => void;
  onBulkEnroll?: () => void;
  onAssignmentEdit: (assignment: Assignment) => void;
  onAssignmentDelete: (assignmentId: string) => void;
  onAssignmentPublishToggle: (assignmentId: string, newValue: boolean) => void;
  onProblemEdit: (problem: Problem) => void;
  onProblemDelete: (problemId: string) => void;
  onRefreshCourse: () => void;
}

export function AdminCourseView({
  course,
  tab,
  onTabChange,
  onCreateAssignment,
  onCreateProblem,
  onEnrollUser,
  onAssignmentEdit,
  onAssignmentDelete,
  onAssignmentPublishToggle,
  onProblemEdit,
  onProblemDelete,
  onRefreshCourse,
  onBulkEnroll,
}: AdminCourseViewProps) {
  const assignmentColumns = useAssignmentColumns(
    onAssignmentDelete,
    onAssignmentEdit,
    onAssignmentPublishToggle,
  );

  const problemCols = useMemo(
    () => problemColumns({ onEdit: onProblemEdit, onDelete: onProblemDelete }),
    [onProblemEdit, onProblemDelete],
  );

  return (
    <Tabs defaultValue="assignments" value={tab} onValueChange={onTabChange}>
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
        <AssignmentsCard
          assignments={course.assignments}
          assignmentColumns={assignmentColumns}
          onCreateAssignment={onCreateAssignment}
        />
      </TabsContent>

      <TabsContent
        value="problems"
        className="animate-fade-in-up transition-opacity duration-300"
      >
        <ProblemsCard
          problems={course.problems}
          problemColumns={problemCols}
          onCreateProblem={onCreateProblem}
        />
      </TabsContent>

      <TabsContent value="roster" className="animate-fade-in-up transition-opacity duration-300">
        <div className="space-y-6">
          <RosterCard
            faculty={course.faculty}
            tas={course.tas}
            students={course.students}
            userColumns={userColumns(onRefreshCourse)}
            onEnrollUser={onEnrollUser}
            onBulkEnroll={onBulkEnroll}
          />
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
          <ActivityCard courseId={course.id} />
        </div>
      </TabsContent>
    </Tabs>
  );
}
