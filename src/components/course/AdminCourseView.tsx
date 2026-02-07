import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActivityCard } from '@/components/ActivityCard';
import { AssignmentsCard } from '@/components/AssignmentsCard';
import { ProblemsCard } from '@/components/ProblemsCard';
import { RosterCard } from '@/components/RosterCard';
import GradesCard from '@/components/GradesCard';
import GroupsCard from '@/components/GroupsCard';
import { userColumns } from '@/app/dashboard/courses/[id]/user-columns';
import { useAssignmentColumns } from '@/app/dashboard/courses/[id]/assignment-columns';
import { useProblemColumns } from '@/app/dashboard/courses/[id]/problem-columns';
import { FullCourse, TabType } from '@/types/course';
import { getInstructors } from '@/lib/course-utils';
import { NotebookText, FileText, GraduationCap, Stamp, Users, Activity } from 'lucide-react';
import { Assignment, Problem } from '@prisma/client';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';

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
  const { timezone } = useEffectiveTimezone();

  const assignmentColumns = useAssignmentColumns(
    course.isArchived,
    onAssignmentDelete,
    onAssignmentEdit,
    onAssignmentPublishToggle,
    timezone,
  );

  const { columns: problemColumns, viewDialog: problemViewDialog } = useProblemColumns({
    courseIsArchived: course.isArchived,
    onEdit: onProblemEdit,
    onDelete: onProblemDelete,
    timeZone: timezone,
  });

  return (
    <Tabs defaultValue="assignments" value={tab} onValueChange={onTabChange}>
      <TabsList className="bg-card border-border h-12 rounded-md border p-1 shadow-sm">
        <TabsTrigger
          className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white hover:bg-gray-200"
          value="assignments"
        >
          <div className="flex items-center gap-2"><NotebookText className="h-4 w-4" />Assignments</div>
        </TabsTrigger>

        <TabsTrigger
          className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white hover:bg-gray-200"
          value="problems"
        >
          <div className="flex items-center gap-2"><FileText className="h-4 w-4" />Problems</div>
        </TabsTrigger>

        <TabsTrigger
          className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white hover:bg-gray-200"
          value="roster"
        >
          <div className="flex items-center gap-2"><GraduationCap className="h-4 w-4" />Roster</div>
        </TabsTrigger>

        <TabsTrigger
          className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white hover:bg-gray-200"
          value="grades"
        >
          <div className="flex items-center gap-2"><Stamp className="h-4 w-4" />Grades</div>
        </TabsTrigger>

        <TabsTrigger
          className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white hover:bg-gray-200"
          value="groups"
        >
          <div className="flex items-center gap-2"><Users className="h-4 w-4" />Groups</div>
        </TabsTrigger>

        <TabsTrigger
          className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white hover:bg-gray-200"
          value="activity"
        >
          <div className="flex items-center gap-2"><Activity className="h-4 w-4" />Activity</div>
        </TabsTrigger>
      </TabsList>

      <TabsContent
        value="assignments"
        className="animate-fade-in-up transition-opacity duration-300"
      >
        <div className="space-y-6 mb-8">
          <AssignmentsCard
            courseId={course.id}
            courseIsArchived={course.isArchived}
            assignments={course.assignments}
            assignmentColumns={assignmentColumns}
            onCreateAssignment={onCreateAssignment}
          />
        </div>
      </TabsContent>

      <TabsContent
        value="problems"
        className="animate-fade-in-up transition-opacity duration-300"
      >
        <div className="space-y-6 mb-8">
          <ProblemsCard
            courseId={course.id}
            courseIsArchived={course.isArchived}
            problems={course.problems}
            problemColumns={problemColumns}
            onCreateProblem={onCreateProblem}
          />

          {problemViewDialog}
        </div>
      </TabsContent>

      <TabsContent value="roster" className="animate-fade-in-up transition-opacity duration-300">
        <div className="space-y-6 mb-8">
          <RosterCard
            courseIsArchived={course.isArchived}
            enrolled={course.enrolled}
            userColumns={userColumns(
              onRefreshCourse,
              course.id,
              course.isArchived,
              // compute faculty count from enrolled
              getInstructors(course.enrolled as any[]).length,
              course.viewerRole,
              course.viewerDefaultRole
            )}
            onEnrollUser={onEnrollUser}
            onBulkEnroll={onBulkEnroll}
          />
        </div>
      </TabsContent>

      <TabsContent value="grades" className="animate-fade-in-up transition-opacity duration-300">
        <div className="space-y-6 mb-8">
          <GradesCard courseId={course.id} />
        </div>
      </TabsContent>

      <TabsContent value="groups" className="animate-fade-in-up transition-opacity duration-300">
        <div className="space-y-6 mb-8">
          <GroupsCard courseId={course.id} />
        </div>
      </TabsContent>

      <TabsContent
        value="activity"
        className="animate-fade-in-up transition-opacity duration-300"
      >
        <div className="space-y-6 mb-8">
          <ActivityCard courseId={course.id} />
        </div>
      </TabsContent>
    </Tabs>
  );
}
