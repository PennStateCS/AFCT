import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActivityCard } from '@/components/ActivityCard';
import { AssignmentsCard } from '@/components/AssignmentsCard';
import { ProblemsCard } from '@/components/ProblemsCard';
import { RosterCard } from '@/components/RosterCard';
import { PrivilegeGradesCard } from '@/components/PrivilegeGradesCard';
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
  const enrolled = course.enrolled ?? [];
  const assignmentCount = course.assignments.length;
  const problemCount = course.problems.length;
  const rosterCount = enrolled.length;

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
      <TabsList
        aria-label="Course content sections"
        className="bg-card border-border h-12 w-full justify-start overflow-x-auto rounded-md border p-1 shadow-sm"
      >
        <TabsTrigger
          id="tab-assignments"
          aria-controls="panel-assignments"
          aria-label={`Assignments (${assignmentCount})`}
          className="data-[state=active]:bg-secondary px-4 whitespace-nowrap hover:bg-gray-200 data-[state=active]:text-white"
          value="assignments"
        >
          <div className="flex items-center gap-2">
            <NotebookText className="h-4 w-4" />
            Assignments ({assignmentCount})
          </div>
        </TabsTrigger>

        <TabsTrigger
          id="tab-problems"
          aria-controls="panel-problems"
          aria-label={`Problems (${problemCount})`}
          className="data-[state=active]:bg-secondary px-4 whitespace-nowrap hover:bg-gray-200 data-[state=active]:text-white"
          value="problems"
        >
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Problems ({problemCount})
          </div>
        </TabsTrigger>

        <TabsTrigger
          id="tab-roster"
          aria-controls="panel-roster"
          aria-label={`Roster (${rosterCount})`}
          className="data-[state=active]:bg-secondary px-4 whitespace-nowrap hover:bg-gray-200 data-[state=active]:text-white"
          value="roster"
        >
          <div className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4" />
            Roster ({rosterCount})
          </div>
        </TabsTrigger>

        <TabsTrigger
          id="tab-grades"
          aria-controls="panel-grades"
          className="data-[state=active]:bg-secondary px-4 whitespace-nowrap hover:bg-gray-200 data-[state=active]:text-white"
          value="grades"
        >
          <div className="flex items-center gap-2">
            <Stamp className="h-4 w-4" />
            Grades
          </div>
        </TabsTrigger>

        <TabsTrigger
          id="tab-groups"
          aria-controls="panel-groups"
          className="data-[state=active]:bg-secondary px-4 whitespace-nowrap hover:bg-gray-200 data-[state=active]:text-white"
          value="groups"
        >
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Groups
          </div>
        </TabsTrigger>

        <TabsTrigger
          id="tab-activity"
          aria-controls="panel-activity"
          className="data-[state=active]:bg-secondary px-4 whitespace-nowrap hover:bg-gray-200 data-[state=active]:text-white"
          value="activity"
        >
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Activity
          </div>
        </TabsTrigger>
      </TabsList>

      <TabsContent
        id="panel-assignments"
        aria-labelledby="tab-assignments"
        value="assignments"
        className="animate-fade-in-up transition-opacity duration-300"
      >
        <div className="mb-8 space-y-6">
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
        id="panel-problems"
        aria-labelledby="tab-problems"
        value="problems"
        className="animate-fade-in-up transition-opacity duration-300"
      >
        <div className="mb-8 space-y-6">
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

      <TabsContent
        id="panel-roster"
        aria-labelledby="tab-roster"
        value="roster"
        className="animate-fade-in-up transition-opacity duration-300"
      >
        <div className="mb-8 space-y-6">
          <RosterCard
            courseIsArchived={course.isArchived}
            enrolled={enrolled}
            userColumns={userColumns(
              onRefreshCourse,
              course.id,
              course.isArchived,
              getInstructors(enrolled).length,
              course.viewerRole,
              course.viewerDefaultRole,
            )}
            onEnrollUser={onEnrollUser}
            onBulkEnroll={onBulkEnroll}
          />
        </div>
      </TabsContent>

      <TabsContent
        id="panel-grades"
        aria-labelledby="tab-grades"
        value="grades"
        className="animate-fade-in-up transition-opacity duration-300"
      >
        <div className="mb-8 space-y-6">
          <PrivilegeGradesCard courseId={course.id} />
        </div>
      </TabsContent>

      <TabsContent
        id="panel-groups"
        aria-labelledby="tab-groups"
        value="groups"
        className="animate-fade-in-up transition-opacity duration-300"
      >
        <div className="mb-8 space-y-6">
          <GroupsCard courseId={course.id} />
        </div>
      </TabsContent>

      <TabsContent
        id="panel-activity"
        aria-labelledby="tab-activity"
        value="activity"
        className="animate-fade-in-up transition-opacity duration-300"
      >
        <div className="mb-8 space-y-6">
          <ActivityCard courseId={course.id} />
        </div>
      </TabsContent>
    </Tabs>
  );
}
