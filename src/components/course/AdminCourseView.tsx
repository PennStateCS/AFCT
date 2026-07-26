import { Settings } from 'lucide-react';

import { Tabs } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CourseHeaderContent } from '@/components/course/CourseHeader';
import { CourseTabBar, CourseTabPanel } from '@/components/course/course-tabs';
import { CourseSettingsForm } from '@/components/course/CourseSettingsForm';
import { CourseStatusCard } from '@/components/course/CourseStatusCard';
import { ActivityCard } from '@/components/ActivityCard';
import { AssignmentsCard } from '@/components/AssignmentsCard';
import { ProblemsCard } from '@/components/ProblemsCard';
import { RosterCard } from '@/components/RosterCard';
import { PrivilegeGradesCard } from '@/components/PrivilegeGradesCard';
import { GroupSetsCard } from '@/components/groups/GroupSetsCard';
import { userColumns } from '@/app/dashboard/courses/[id]/user-columns';
import { useAssignmentColumns } from '@/app/dashboard/courses/[id]/assignment-columns';
import { useProblemColumns } from '@/app/dashboard/courses/[id]/problem-columns';
import {
  DuplicateAssignmentDialog,
  type DuplicateSourceAssignment,
} from '@/components/dialogs/DuplicateAssignmentDialog';
import {
  DuplicateProblemDialog,
  type DuplicateSourceProblem,
} from '@/components/dialogs/DuplicateProblemDialog';
import { ImportAssignmentDialog } from '@/components/dialogs/ImportAssignmentDialog';
import { ImportProblemDialog } from '@/components/dialogs/ImportProblemDialog';
import type { FullCourse, TabType } from '@/types/course';
import type { Problem, Course } from '@prisma/client';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { useMemo, useState } from 'react';

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
  onAssignmentDelete: (assignmentId: string) => void;
  onAssignmentPublishToggle: (assignmentId: string, newValue: boolean) => void;
  onProblemEdit: (problem: Problem) => void;
  onProblemDelete: (problemId: string) => void;
  onRefreshCourse: () => void;
  onCourseSaved: (updated: Partial<Course>) => void;
  onPublishToggle: (checked: boolean) => void;
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
  onAssignmentDelete,
  onAssignmentPublishToggle,
  onProblemEdit,
  onProblemDelete,
  onRefreshCourse,
  onBulkEnroll,
  onCourseSaved,
  onPublishToggle,
}: AdminCourseViewProps) {
  const { timezone } = useEffectiveTimezone();
  const enrolled = course.enrolled ?? [];
  const assignmentCount = course.assignmentTotal ?? course.assignments.length;
  const problemCount = course.problemTotal ?? course.problems.length;
  const rosterCount = course.rosterTotal ?? enrolled.length;

  // The assignment being duplicated (opens the wizard); null when closed.
  const [duplicateTarget, setDuplicateTarget] = useState<DuplicateSourceAssignment | null>(null);

  // Whether the "import assignment from another course" wizard is open.
  const [importAssignmentOpen, setImportAssignmentOpen] = useState(false);

  const assignmentColumns = useAssignmentColumns(
    course.isArchived,
    onAssignmentDelete,
    onAssignmentPublishToggle,
    timezone,
    setDuplicateTarget,
  );

  // The problem being duplicated (opens the dialog); null when closed.
  const [duplicateProblemTarget, setDuplicateProblemTarget] =
    useState<DuplicateSourceProblem | null>(null);

  // Whether the "import problem from another course" wizard is open.
  const [importProblemOpen, setImportProblemOpen] = useState(false);

  const { columns: problemColumns, viewDialog: problemViewDialog } = useProblemColumns({
    courseIsArchived: course.isArchived,
    onEdit: onProblemEdit,
    onDelete: onProblemDelete,
    onDuplicate: setDuplicateProblemTarget,
    timeZone: timezone,
  });

  // Memoize roster columns so a re-render doesn't recreate the array (and its
  // cell components), which would force RosterCard's DataTable and its rows to
  // re-render.
  const rosterColumns = useMemo(
    () =>
      userColumns(
        onRefreshCourse,
        course.id,
        course.isArchived,
        course.viewerRole,
        course.viewerIsAdmin
      ),
    [
      onRefreshCourse,
      course.id,
      course.isArchived,
      course.viewerRole,
      course.viewerIsAdmin,
    ],
  );

  return (
    <>
    <Tabs defaultValue="assignments" value={tab} onValueChange={onTabChange}>
      <Card>
        <CardHeader className="grid grid-cols-1 gap-3">
          <CourseHeaderContent course={course} isStudent={false} />
        </CardHeader>

        <CardContent className="space-y-6">
          <CourseTabBar
            value={tab}
            onValueChange={onTabChange}
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
              onImportAssignment={() => setImportAssignmentOpen(true)}
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
              onImportProblem={() => setImportProblemOpen(true)}
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
            <GroupSetsCard courseId={course.id} courseIsArchived={course.isArchived} />
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
              {/* Form on the left; the immediate-effect status switches sit in their
                  own card to the right (stacked below on narrow screens). */}
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <CourseSettingsForm course={course} onSaved={onCourseSaved} className="w-full" />
                <CourseStatusCard
                  course={course}
                  onPublishToggle={onPublishToggle}
                  className="w-full lg:w-80 lg:shrink-0"
                />
              </div>
            </div>
          </CourseTabPanel>
        </CardContent>
      </Card>
    </Tabs>

    <DuplicateAssignmentDialog
      open={!!duplicateTarget}
      setOpen={(v) => {
        if (!v) setDuplicateTarget(null);
      }}
      courseId={course.id}
      courseIsArchived={course.isArchived}
      assignment={duplicateTarget}
      onDuplicated={() => {
        setDuplicateTarget(null);
        // The new (unpublished) assignment now exists; refresh the list to show it.
        onRefreshCourse();
      }}
    />

    <ImportAssignmentDialog
      open={importAssignmentOpen}
      setOpen={setImportAssignmentOpen}
      courseId={course.id}
      courseIsArchived={course.isArchived}
      onImported={() => {
        setImportAssignmentOpen(false);
        // The imported (unpublished) assignment now exists; refresh the list to show it.
        onRefreshCourse();
      }}
    />

    <DuplicateProblemDialog
      open={!!duplicateProblemTarget}
      setOpen={(v) => {
        if (!v) setDuplicateProblemTarget(null);
      }}
      courseId={course.id}
      courseIsArchived={course.isArchived}
      problem={duplicateProblemTarget}
      onDuplicated={() => {
        setDuplicateProblemTarget(null);
        // Back on the Problems tab: refresh so the new problem appears in the list.
        onRefreshCourse();
      }}
    />

    <ImportProblemDialog
      open={importProblemOpen}
      setOpen={setImportProblemOpen}
      courseId={course.id}
      courseIsArchived={course.isArchived}
      onImported={() => {
        setImportProblemOpen(false);
        // The imported problem now exists in this course; refresh the problems list.
        onRefreshCourse();
      }}
    />
    </>
  );
}
