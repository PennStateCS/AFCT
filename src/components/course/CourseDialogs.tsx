import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import type { FullCourse, DeleteTarget, EnrollableUser } from '@/types/course';
import type { Assignment, Problem } from '@prisma/client';

/**
 * The course page's dialogs load on demand.
 *
 * Between them these carry the form stack (zod, react-hook-form) and the problem editor, and
 * this file used to render them all on mount, so opening a course paid for every dialog it
 * offers whether or not any were used. That was most of this route's 795 KB of its own code.
 *
 * `ConfirmDialog` stays a normal import: it is small, has no form machinery, and is used all
 * over the app, so it is in the shared chunk regardless. Splitting it would add a request
 * without removing bytes.
 */
const CreateProblemDialog = dynamic(
  () => import('@/components/dialogs/CreateProblemDialog').then((m) => m.CreateProblemDialog),
  { ssr: false },
);
const EditProblemDialog = dynamic(
  () => import('@/components/dialogs/EditProblemDialog').then((m) => m.EditProblemDialog),
  { ssr: false },
);
const CreateAssignmentWizardDialog = dynamic(
  () =>
    import('@/components/dialogs/CreateAssignmentWizardDialog').then(
      (m) => m.CreateAssignmentWizardDialog,
    ),
  { ssr: false },
);
const EnrollUserDialog = dynamic(
  () => import('@/components/dialogs/EnrollUsersDialog').then((m) => m.EnrollUserDialog),
  { ssr: false },
);
const BulkEnrollDialog = dynamic(() => import('@/components/dialogs/BulkEnrollDialog'), {
  ssr: false,
});

/**
 * True once `open` has first been true, and true forever after.
 *
 * A dynamic import is only deferred while the component is not rendered, so each dialog has to
 * stay out of the tree until it is first opened. Staying mounted afterwards leaves Radix its
 * closing animation and keeps any in-progress form state across a close/reopen.
 */
function useMountedOnce(open: boolean): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  // `|| open` so the dialog renders on the same pass that opens it, not a frame later.
  return mounted || open;
}

interface CourseDialogsProps {
  course: FullCourse;
  timeZone: string;

  // Problems
  problemOpen: boolean;
  setProblemOpen: (open: boolean) => void;
  editProblemOpen: boolean;
  setEditProblemOpen: (open: boolean) => void;
  selectedProblem: Problem | null;
  setSelectedProblem: (problem: Problem | null) => void;
  onProblemCreated: (problem?: Problem) => void;
  onProblemSaved: (problem?: Problem) => void;

  // Assignments (editing lives on the assignment page's Settings tab now)
  createAssignmentOpen: boolean;
  setCreateAssignmentOpen: (open: boolean) => void;
  onAssignmentCreate: (assignment: Assignment) => void;

  // Delete confirm
  confirmOpen: boolean;
  pendingDelete: DeleteTarget | null;
  onConfirm: () => void;
  onCancel: () => void;

  // Publish confirm
  publishConfirmOpen: boolean;
  pendingPublish: boolean | null;
  onPublishConfirm: () => void;
  onPublishCancel: () => void;

  // Enroll user
  enrollOpen: boolean;
  setEnrollOpen: (open: boolean) => void;
  allUsers: EnrollableUser[];
  /** How many accounts match the current search, which may exceed the page above. */
  enrollableTotal?: number;
  /** Debounced search term from the dialog, so the caller can refetch. */
  onEnrollSearchChange?: (q: string) => void;
  onEnrollUser: (user: EnrollableUser) => void;
  // Bulk enroll
  bulkEnrollOpen?: boolean;
  setBulkEnrollOpen?: (open: boolean) => void;
  onBulkEnrollComplete?: () => void;
}

export function CourseDialogs({
  course,
  timeZone,

  problemOpen,
  setProblemOpen,
  editProblemOpen,
  setEditProblemOpen,
  selectedProblem,
  setSelectedProblem,
  onProblemCreated,
  onProblemSaved,

  createAssignmentOpen,
  setCreateAssignmentOpen,
  onAssignmentCreate,
  confirmOpen,
  pendingDelete,
  onConfirm,
  onCancel,

  publishConfirmOpen,
  pendingPublish,
  onPublishConfirm,
  onPublishCancel,

  enrollOpen,
  setEnrollOpen,
  allUsers,
  enrollableTotal,
  onEnrollSearchChange,
  onEnrollUser,
  bulkEnrollOpen,
  setBulkEnrollOpen,
  onBulkEnrollComplete,
}: CourseDialogsProps) {
  const problemMounted = useMountedOnce(problemOpen);
  const editProblemMounted = useMountedOnce(editProblemOpen);
  const createAssignmentMounted = useMountedOnce(createAssignmentOpen);
  const enrollMounted = useMountedOnce(enrollOpen);
  const bulkEnrollMounted = useMountedOnce(!!bulkEnrollOpen);

  return (
    <>
      {problemMounted && (
        <CreateProblemDialog
          open={problemOpen}
          setOpen={setProblemOpen}
          courseId={course.id}
          courseIsArchived={course.isArchived}
          onCreated={onProblemCreated}
        />
      )}

      {selectedProblem && editProblemMounted && (
        <EditProblemDialog
          courseIsArchived={course.isArchived}
          problem={selectedProblem}
          open={editProblemOpen}
          setOpen={(val) => {
            setEditProblemOpen(val);
            if (!val) setSelectedProblem(null);
          }}
          onSaved={onProblemSaved}
        />
      )}

      {createAssignmentMounted && (
        <CreateAssignmentWizardDialog
          open={createAssignmentOpen}
          setOpen={setCreateAssignmentOpen}
          courseId={course.id}
          courseIsArchived={course.isArchived}
          // New due dates are interpreted in the COURSE's zone, not the viewer's.
          timeZone={course.timezone ?? timeZone}
          onCreate={onAssignmentCreate}
        />
      )}

      <ConfirmDialog
        open={confirmOpen}
        variant="destructive"
        title={pendingDelete?.type === 'assignment' ? 'Delete assignment?' : 'Delete problem?'}
        description={
          pendingDelete?.type === 'assignment'
            ? 'This permanently deletes the assignment and cannot be undone.'
            : 'This permanently deletes the problem and cannot be undone.'
        }
        confirmText={pendingDelete?.type === 'assignment' ? 'Delete assignment' : 'Delete problem'}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />

      <ConfirmDialog
        open={publishConfirmOpen}
        confirmText={pendingPublish ? 'Publish' : 'Unpublish'}
        title={pendingPublish ? 'Publish course?' : 'Unpublish course?'}
        description={
          pendingPublish
            ? 'This takes effect immediately: the course becomes visible to enrolled students as soon as you confirm.'
            : 'This takes effect immediately: students will no longer see the course as soon as you confirm.'
        }
        onConfirm={onPublishConfirm}
        onCancel={onPublishCancel}
      />

      {enrollMounted && (
        <EnrollUserDialog
          open={enrollOpen}
          setOpen={setEnrollOpen}
          courseIsArchived={course.isArchived}
          users={allUsers}
          total={enrollableTotal}
          onSearchChange={onEnrollSearchChange}
          onEnroll={onEnrollUser}
        />
      )}

      {setBulkEnrollOpen && bulkEnrollMounted && (
        <BulkEnrollDialog
          open={!!bulkEnrollOpen}
          setOpen={(v) => setBulkEnrollOpen?.(v)}
          courseId={course.id}
          courseIsArchived={course.isArchived}
          onComplete={onBulkEnrollComplete}
        />
      )}
    </>
  );
}
