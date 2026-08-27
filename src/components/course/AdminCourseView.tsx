import dynamic from 'next/dynamic';
import { Settings } from 'lucide-react';

import { Tabs } from '@/components/ui/tabs';
import { CourseHeaderContent } from '@/components/course/CourseHeader';
import { CourseTabBar, CourseTabPanel } from '@/components/course/course-tabs';
import { LocalNavLayout } from '@/components/local-nav';
import { useIsDesktopNav } from '@/hooks/use-desktop-nav';
import { CourseStatusCard } from '@/components/course/CourseStatusCard';
import { CourseLmsSection } from '@/components/course/CourseLmsSection';
import { SettingsAsideLayout } from '@/components/settings/settings-layout';
import { ActivityCard } from '@/components/ActivityCard';
import { AssignmentsCard } from '@/components/AssignmentsCard';
import { ProblemsCard } from '@/components/ProblemsCard';
import { RosterCard } from '@/components/RosterCard';
import { PrivilegeGradesCard } from '@/components/PrivilegeGradesCard';
import { GroupSetsCard } from '@/components/groups/GroupSetsCard';
import { userColumns } from '@/app/dashboard/courses/[id]/user-columns';
import { useAssignmentColumns } from '@/app/dashboard/courses/[id]/assignment-columns';
import { useProblemColumns } from '@/app/dashboard/courses/[id]/problem-columns';
import type { DuplicateSourceAssignment } from '@/components/dialogs/DuplicateAssignmentDialog';
import type { DuplicateSourceProblem } from '@/components/dialogs/DuplicateProblemDialog';

/**
 * The duplicate/import dialogs load on demand: they carry the form stack, and a course page
 * that is only being read should not pay for four dialogs nobody opened. Each is also rendered
 * only once opened, because a dynamic import is deferred only while its component is unrendered.
 */
const DuplicateAssignmentDialog = dynamic(
  () =>
    import('@/components/dialogs/DuplicateAssignmentDialog').then(
      (m) => m.DuplicateAssignmentDialog,
    ),
  { ssr: false },
);
const DuplicateProblemDialog = dynamic(
  () => import('@/components/dialogs/DuplicateProblemDialog').then((m) => m.DuplicateProblemDialog),
  { ssr: false },
);
const ImportAssignmentDialog = dynamic(
  () => import('@/components/dialogs/ImportAssignmentDialog').then((m) => m.ImportAssignmentDialog),
  { ssr: false },
);
const ImportProblemDialog = dynamic(
  () => import('@/components/dialogs/ImportProblemDialog').then((m) => m.ImportProblemDialog),
  { ssr: false },
);

/**
 * The settings form is the last thing holding zod on this route, and it is a whole tab that
 * most visits never open: people come here to look at assignments, problems or the roster.
 * `CourseTabPanel` already renders its children only while the tab is active, so the import is
 * genuinely deferred without any extra gating.
 *
 * Unlike the dialogs above this one gets a `loading` state, because it occupies the panel the
 * author is looking at rather than appearing over it, and an empty panel reads as a bug.
 */
const CourseSettingsForm = dynamic(
  () => import('@/components/course/CourseSettingsForm').then((m) => m.CourseSettingsForm),
  {
    ssr: false,
    loading: () => <p className="text-muted-foreground w-full text-sm">Loading course settings…</p>,
  },
);
import type { FullCourse, TabType } from '@/types/course';
import type { Problem, Course } from '@prisma/client';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { useEffect, useMemo, useState } from 'react';

/** True once `open` has first been true. See the dynamic imports above. */
function useMountedOnce(open: boolean): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return mounted || open;
}

interface AdminCourseViewProps {
  course: FullCourse;
  tab: TabType;
  isAssignmentsLoading?: boolean;
  isProblemsLoading?: boolean;
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
  const assignmentCount = course.assignmentTotal ?? course.assignments.length;
  const problemCount = course.problemTotal ?? course.problems.length;
  // The whole roster's size, staff and students together. There is no local array to fall
  // back to any more: the payload carries staff only and the tab pages the rest.
  const rosterCount = course.rosterTotal ?? 0;

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

  const duplicateAssignmentMounted = useMountedOnce(!!duplicateTarget);
  const importAssignmentMounted = useMountedOnce(importAssignmentOpen);
  const duplicateProblemMounted = useMountedOnce(!!duplicateProblemTarget);
  const importProblemMounted = useMountedOnce(importProblemOpen);

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
        course.viewerIsAdmin,
      ),
    [onRefreshCourse, course.id, course.isArchived, course.viewerRole, course.viewerIsAdmin],
  );

  const railNav = useIsDesktopNav();

  // Tabs orientation follows whichever control is on screen: arrow keys run up and down
  // in the rail and left and right in the strip, and aria-orientation reports the same.
  // The header and tab strip sit on the page itself now, not inside a card wrapping
  // the whole workspace. CourseHeaderContent returns a fragment, so the grid that
  // spaced its rows came from the CardHeader and has to travel with it.
  return (
    <>
      <Tabs
        defaultValue="assignments"
        value={tab}
        onValueChange={onTabChange}
        orientation={railNav ? 'vertical' : 'horizontal'}
        // gap-6, and the number is not arbitrary: `dashboard/layout.tsx` puts py-6 above
        // the banner, so this is what makes the air under it match the air over it. It was
        // gap-4, set when that padding was 16px, and it has read as a squeeze ever since.
        //
        // A gap, not a space-y-*. The Tabs primitive is `flex flex-col gap-2`, and a space-y-*
        // on top of that does not replace the gap, it ADDS to it: tailwind-merge only
        // reconciles classes that set the same property, and gap and margin are not the same
        // property. One mechanism, one value.
        className="gap-6"
      >
        <CourseHeaderContent course={course} isStudent={false} />

        {/* Below lg this is a plain stack, so the strip sits above the panels exactly as it
          did. At lg the rail takes a column beside them (LocalNavLayout owns that width, so
          collapsing the rail actually hands the room to the workspace). */}
        <LocalNavLayout
          breakpoint="lg"
          nav={
            <CourseTabBar
              value={tab}
              onValueChange={onTabChange}
              rail={railNav}
              counts={{
                assignments: assignmentCount,
                problems: problemCount,
                roster: rosterCount,
              }}
            />
          }
        >
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
              courseId={course.id}
              courseIsArchived={course.isArchived}
              userColumns={rosterColumns}
              onEnrollUser={onEnrollUser}
              onBulkEnroll={onBulkEnroll}
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
            <div className="space-y-6">
              {/* Heading and its explanation are one header block, so the 12px below
                  separates the block from the form rather than the sentence from its
                  title. Same shape the student Assignments panel already uses. */}
              <div className="space-y-1">
                <h2 className="flex items-center gap-2 text-xl font-semibold">
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
              </div>
              {/* The System Settings layout, not a bespoke one: grouped panels in the main
                  column and the immediate-effect publish switch in the rail beside them.
                  Before this the form was a single max-w-xl column of eleven fields with the
                  status card floating 440px away from its right edge, on a tab a professor
                  reaches straight from System Settings. */}
              <SettingsAsideLayout
                aside={
                  <>
                    <CourseStatusCard course={course} onPublishToggle={onPublishToggle} />
                    {/* Under the status card, and renders nothing unless an LMS opens this
                        course. Both are things the course IS rather than fields Save writes,
                        which is what the rail is for. */}
                    <CourseLmsSection courseId={course.id} />
                  </>
                }
              >
                <CourseSettingsForm course={course} onSaved={onCourseSaved} />
              </SettingsAsideLayout>
            </div>
          </CourseTabPanel>
        </LocalNavLayout>
      </Tabs>

      {duplicateAssignmentMounted && (
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
      )}

      {importAssignmentMounted && (
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
      )}

      {duplicateProblemMounted && (
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
      )}

      {importProblemMounted && (
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
      )}
    </>
  );
}
