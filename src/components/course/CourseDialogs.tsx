import { CreateProblemDialog } from '@/components/dialogs/CreateProblemDialog';
import { EditProblemDialog } from '@/components/dialogs/EditProblemDialog';
import { CreateAssignmentWizardDialog } from '@/components/dialogs/CreateAssignmentWizardDialog';
import { EnrollUserDialog } from '@/components/dialogs/EnrollUsersDialog';
import BulkEnrollDialog from '@/components/dialogs/BulkEnrollDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import type { FullCourse, DeleteTarget, EnrollableUser } from '@/types/course';
import type { Assignment, Problem } from '@prisma/client';

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
  onEnrollUser,
  bulkEnrollOpen,
  setBulkEnrollOpen,
  onBulkEnrollComplete,
}: CourseDialogsProps) {
  return (
    <>
      <CreateProblemDialog
        open={problemOpen}
        setOpen={setProblemOpen}
        courseId={course.id}
        courseIsArchived={course.isArchived}
        onCreated={onProblemCreated}
      />

      {selectedProblem && (
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

      <CreateAssignmentWizardDialog
        open={createAssignmentOpen}
        setOpen={setCreateAssignmentOpen}
        courseId={course.id}
        courseIsArchived={course.isArchived}
        // New due dates are interpreted in the COURSE's zone, not the viewer's.
        timeZone={course.timezone ?? timeZone}
        onCreate={onAssignmentCreate}
      />

      <ConfirmDialog
        open={confirmOpen}
        title={pendingDelete?.type === 'assignment' ? 'Delete Assignment?' : 'Delete Problem?'}
        description="Are you sure you want to delete this item? This cannot be undone."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />

      <ConfirmDialog
        open={publishConfirmOpen}
        confirmText={pendingPublish ? 'Publish' : 'Unpublish'}
        title={pendingPublish ? 'Publish Course?' : 'Unpublish Course?'}
        description={
          pendingPublish
            ? 'This takes effect immediately: the course becomes visible to enrolled students as soon as you confirm.'
            : 'This takes effect immediately: students will no longer see the course as soon as you confirm.'
        }
        onConfirm={onPublishConfirm}
        onCancel={onPublishCancel}
      />

      <EnrollUserDialog
        open={enrollOpen}
        setOpen={setEnrollOpen}
        courseIsArchived={course.isArchived}
        users={allUsers}
        onEnroll={onEnrollUser}
      />

      {setBulkEnrollOpen && (
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
