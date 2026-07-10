import { Settings } from 'lucide-react';

import { Tabs } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CourseHeaderContent } from '@/components/course/CourseHeader';
import { CourseTabBar, CourseTabPanel } from '@/components/course/course-tabs';
import { CourseSettingsForm } from '@/components/course/CourseSettingsForm';
import { ActivityCard } from '@/components/ActivityCard';
import { AssignmentsCard } from '@/components/AssignmentsCard';
import { ProblemsCard } from '@/components/ProblemsCard';
import { RosterCard } from '@/components/RosterCard';
import { PrivilegeGradesCard } from '@/components/PrivilegeGradesCard';
import GroupsCard from '@/components/GroupsCard';
import { userColumns } from '@/app/dashboard/courses/[id]/user-columns';
import { useAssignmentColumns } from '@/app/dashboard/courses/[id]/assignment-columns';
import { useProblemColumns } from '@/app/dashboard/courses/[id]/problem-columns';
import type { FullCourse, TabType } from '@/types/course';
import { getInstructors } from '@/lib/course-utils';
import type { Assignment, Problem, Course } from '@prisma/client';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { useMemo } from 'react';

interface AdminCourseViewProps {
  course: FullCourse;
  tab: TabType;
  isAssignmentsLoading?: boolean;
  isProblemsLoading?: boolean;
  isRosterLoading?: boolean;
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
  onCourseSaved: (updated: Partial<Course>) => void;
  onPublishToggle: (checked: boolean) => void;
  onArchiveToggle: (checked: boolean) => void;
}

export function AdminCourseView({
  course,
  tab,
  isAssignmentsLoading = false,
  isProblemsLoading = false,
  isRosterLoading = false,
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
  onCourseSaved,
  onPublishToggle,
  onArchiveToggle,
}: AdminCourseViewProps) {
  const { timezone } = useEffectiveTimezone();
  const enrolled = course.enrolled ?? [];
  const assignmentCount = course.assignmentTotal ?? course.assignments.length;
  const problemCount = course.problemTotal ?? course.problems.length;
  const rosterCount = course.rosterTotal ?? enrolled.length;

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

  // Memoize roster columns so a re-render doesn't recreate the array (and its
  // cell components), which would force RosterCard's DataTable and its rows to
  // re-render.
  const facultyCount = getInstructors(enrolled).length;
  const rosterColumns = useMemo(
    () =>
      userColumns(
        onRefreshCourse,
        course.id,
        course.isArchived,
        facultyCount,
        course.viewerRole,
        course.viewerIsAdmin,
      ),
    [
      onRefreshCourse,
      course.id,
      course.isArchived,
      facultyCount,
      course.viewerRole,
      course.viewerIsAdmin,
    ],
  );

  return (
    <Tabs defaultValue="assignments" value={tab} onValueChange={onTabChange}>
      <Card>
        <CardHeader className="grid grid-cols-1 gap-3">
          <CourseHeaderContent course={course} isStudent={false} />
        </CardHeader>

        <CardContent className="space-y-6">
          <CourseTabBar
            counts={{
              assignments: assignmentCount,
              problems: problemCount,
              roster: rosterCount,
            }}
          />

          <CourseTabPanel value="assignments" active={tab === 'assignments'}>
            <AssignmentsCard
              courseId={course.id}
              courseIsArchived={course.isArchived}
              assignments={course.assignments}
              assignmentColumns={assignmentColumns}
              onCreateAssignment={onCreateAssignment}
              isLoading={isAssignmentsLoading}
            />
          </CourseTabPanel>

          <CourseTabPanel value="problems" active={tab === 'problems'}>
            <ProblemsCard
              courseId={course.id}
              courseIsArchived={course.isArchived}
              problems={course.problems}
              problemColumns={problemColumns}
              onCreateProblem={onCreateProblem}
              isLoading={isProblemsLoading}
            />
            {problemViewDialog}
          </CourseTabPanel>

          <CourseTabPanel value="roster" active={tab === 'roster'}>
            <RosterCard
              courseIsArchived={course.isArchived}
              enrolled={enrolled}
              userColumns={rosterColumns}
              onEnrollUser={onEnrollUser}
              onBulkEnroll={onBulkEnroll}
              loading={isRosterLoading}
            />
          </CourseTabPanel>

          <CourseTabPanel value="grades" active={tab === 'grades'}>
            <PrivilegeGradesCard courseId={course.id} />
          </CourseTabPanel>

          <CourseTabPanel value="groups" active={tab === 'groups'}>
            <GroupsCard courseId={course.id} />
          </CourseTabPanel>

          <CourseTabPanel value="activity" active={tab === 'activity'}>
            <ActivityCard courseId={course.id} />
          </CourseTabPanel>

          <CourseTabPanel value="settings" active={tab === 'settings'}>
            <div className="space-y-4">
              <h2
                role="heading"
                aria-level={2}
                className="flex items-center gap-2 text-2xl font-semibold"
              >
                <Settings className="h-5 w-5" />
                Course Settings
              </h2>
              <p className="text-muted-foreground text-sm">
                Edit the course name, code, dates, timezone, and self-registration settings.
              </p>
              {course.isArchived ? (
                <p className="text-muted-foreground text-xs">
                  This course is archived and read-only. Unarchive it to make changes.
                </p>
              ) : null}
              <CourseSettingsForm
                course={course}
                onSaved={onCourseSaved}
                onPublishToggle={onPublishToggle}
                onArchiveToggle={onArchiveToggle}
              />
            </div>
          </CourseTabPanel>
        </CardContent>
      </Card>
    </Tabs>
  );
}
