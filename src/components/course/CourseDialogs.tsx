import { CreateProblemDialog } from '@/components/dialogs/CreateProblemDialog';
import { EditProblemDialog } from '@/components/dialogs/EditProblemDialog';
import { EditCourseDialog } from '@/components/dialogs/EditCourseDialog';
import { EditAssignmentDialog } from '@/components/dialogs/EditAssignmentDialog';
import { CreateAssignmentDialog } from '@/components/dialogs/CreateAssignmentDialog';
import { EnrollUserDialog } from '@/components/dialogs/EnrollUsersDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { FullCourse, DeleteTarget, EnrollableUser } from '@/types/course';
import { Assignment, Problem, Course } from '@prisma/client';

interface CourseDialogsProps {
  course: FullCourse;
  // Edit course
  editOpen: boolean;
  setEditOpen: (open: boolean) => void;
  onCourseSave: (course: Partial<Course>) => void;
  
  // Problems
  problemOpen: boolean;
  setProblemOpen: (open: boolean) => void;
  editProblemOpen: boolean;
  setEditProblemOpen: (open: boolean) => void;
  selectedProblem: Problem | null;
  setSelectedProblem: (problem: Problem | null) => void;
  onProblemCreated: (problem?: Problem) => void;
  onProblemSaved: (problem?: Problem) => void;
  
  // Assignments
  editAssignmentOpen: boolean;
  setEditAssignmentOpen: (open: boolean) => void;
  selectedAssignment: Assignment | null;
  createAssignmentOpen: boolean;
  setCreateAssignmentOpen: (open: boolean) => void;
  onAssignmentSave: (assignment: Assignment) => void;
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
}

export function CourseDialogs({
  course,
  editOpen,
  setEditOpen,
  onCourseSave,
  problemOpen,
  setProblemOpen,
  editProblemOpen,
  setEditProblemOpen,
  selectedProblem,
  setSelectedProblem,
  onProblemCreated,
  onProblemSaved,
  editAssignmentOpen,
  setEditAssignmentOpen,
  selectedAssignment,
  createAssignmentOpen,
  setCreateAssignmentOpen,
  onAssignmentSave,
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
}: CourseDialogsProps) {
  return (
    <>
      <EditCourseDialog
        course={course}
        open={editOpen}
        setOpen={setEditOpen}
        onSave={onCourseSave}
      />

      <CreateProblemDialog
        open={problemOpen}
        setOpen={setProblemOpen}
        courseId={course.id}
        onCreated={onProblemCreated}
      />

      {selectedAssignment && (
        <EditAssignmentDialog
          assignment={selectedAssignment}
          open={editAssignmentOpen}
          setOpen={setEditAssignmentOpen}
          onSave={onAssignmentSave}
        />
      )}

      {selectedProblem && (
        <EditProblemDialog
          problem={selectedProblem}
          open={editProblemOpen}
          setOpen={(val) => {
            setEditProblemOpen(val);
            if (!val) setSelectedProblem(null);
          }}
          onSaved={onProblemSaved}
        />
      )}

      <CreateAssignmentDialog
        open={createAssignmentOpen}
        setOpen={setCreateAssignmentOpen}
        courseId={course.id}
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
            ? 'Are you sure you want to publish this course? It will be visible to students.'
            : 'Are you sure you want to unpublish this course? Students will no longer see it.'
        }
        onConfirm={onPublishConfirm}
        onCancel={onPublishCancel}
      />

      <EnrollUserDialog
        open={enrollOpen}
        setOpen={setEnrollOpen}
        users={allUsers}
        onEnroll={onEnrollUser}
      />
    </>
  );
}
