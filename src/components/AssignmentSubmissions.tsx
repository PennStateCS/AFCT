'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import type { Submission, User } from '@prisma/client';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { rerunSubmission } from '@/app/utils/rerunSubmission';
import type { Comment as DiscussionComment } from './DiscussionPanel';
import ProblemWorkspace from '@/components/assignments/ProblemWorkspace';
import type { ProblemSubmission } from '@/lib/problem-submission';
import StudentNavigator from './StudentNavigator';
import { ProblemPicker } from '@/components/assignments/ProblemPicker';
import { ProgressRing } from '@/components/assignments/ProgressRing';
import { StudentSchedule } from '@/components/assignments/StudentSchedule';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { queryKeys } from '@/lib/query-keys';
import { fetchJson } from '@/lib/query-fetch';
import { useEmptyStringSymbol } from '@/hooks/use-empty-string-symbol';
import { SubmissionViewerDialog } from '@/components/dialogs/SubmissionViewerDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
// The same loading indicator the tables use. It lives under data-table-status because that
// is where it started, but it is the app's status renderer rather than a table-only one.
import { DataTableLoading } from '@/components/ui/data-table-status';
import dynamic from 'next/dynamic';

// On demand: the grant dialog carries the form stack and was the last thing putting zod on the
// assignment route. Staff open it rarely, and never on arrival.
const GrantExtraSubmissionsDialog = dynamic(
  () =>
    import('@/components/dialogs/GrantExtraSubmissionsDialog').then(
      (m) => m.GrantExtraSubmissionsDialog,
    ),
  { ssr: false },
);
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { MoreVertical } from 'lucide-react';
import { useReviewData } from './useReviewData';
import { useComments } from './useComments';
import { useProblemGrades } from './useProblemGrades';
import { useReviewSelection } from './useReviewSelection';

type Person = Pick<User, 'firstName' | 'lastName' | 'id'> & { enrollmentStatus?: string | null };

type Problem = {
  id: string;
  title: string;
  description?: string;
  type?: string;
  maxPoints?: number;
  maxStates?: number;
  isDeterministic?: boolean;
  fileName?: string;
  originalFileName?: string;
  maxSubmissions?: number;
  autograderEnabled?: boolean;
};

type SubmissionData = Submission[] | { submissions: Submission[] };

type Props = {
  courseIsArchived: boolean;
  courseId: string;
  assignmentId: string;
  maxAssignmentGrade: number;
  assignmentDueDate?: string | Date | null;
  problems?: Problem[];
};

// Helpers
const hasSubmissions = (obj: unknown): obj is { submissions: Submission[] } => {
  return (
    !!obj &&
    typeof obj === 'object' &&
    Array.isArray((obj as { submissions?: unknown }).submissions)
  );
};

/** True when the key event originates from a text field, so global shortcuts stay dormant. */
const isTypingTarget = (e: KeyboardEvent): boolean => {
  if (e.altKey || e.ctrlKey || e.metaKey) return true;
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
};

const extractSubs = (raw?: SubmissionData): Submission[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;

  // TypeScript now automatically knows 'raw' has the submissions array
  if (hasSubmissions(raw)) {
    return raw.submissions;
  }

  return [];
};

export default function AssignmentSubmissions({
  courseIsArchived,
  courseId,
  assignmentId,
  assignmentDueDate,
  problems,
}: Props) {
  const epsSymbol = useEmptyStringSymbol(courseId);
  const [rerunning, setRerunning] = useState<Record<string, boolean>>({});
  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  // Set on first open and never cleared, so the dynamic import above stays deferred.
  const [grantMounted, setGrantMounted] = useState(false);
  useEffect(() => {
    if (grantDialogOpen) setGrantMounted(true);
  }, [grantDialogOpen]);

  const [showStudentDataLoading, setShowStudentDataLoading] = useState(false);
  const [openDialog, setOpenDialog] = useState<{
    open: boolean;
    submission: Submission | ProblemSubmission | null;
  }>({ open: false, submission: null });

  // Students for review: includes DROPPED students (labeled), since staff still review
  // their submitted work. Its own query key ('students', 'all') so it doesn't collide
  // with the active-only list GroupsCard/audience pickers share.
  const { timezone } = useEffectiveTimezone();
  const assignmentShellQuery = useQuery<{
    dueDate?: string | Date;
    allowLateSubmissions?: boolean;
    lateCutoff?: string | Date | null;
  }>({
    queryKey: queryKeys.assignment.shell(courseId, assignmentId),
    queryFn: () =>
      fetchJson(apiPaths.assignment(courseId, assignmentId, { view: 'problems' })),
    enabled: !!assignmentId,
    staleTime: 30_000,
  });
  const assignmentShell = assignmentShellQuery.isError ? null : (assignmentShellQuery.data ?? null);

  const studentsQuery = useQuery({
    queryKey: ['course', courseId, 'students', 'all'],
    queryFn: async () => {
      const res = await fetch(apiPaths.courseStudents(courseId, { includeDropped: true }));
      if (!res.ok)
        throw new Error(
          (await res.json())?.error ||
            'Could not load the student list. Refresh the page to try again.',
        );
      return (await res.json()) as Person[];
    },
    staleTime: 30_000,
  });

  // Derived, sorted students list (replaces the old `students` useState). Sort
  // alphabetically by last name, then first name (case-insensitive).
  const students = useMemo<Person[]>(() => {
    return [...(studentsQuery.data ?? [])].sort((a, b) => {
      const aLast = (a.lastName ?? '').toLowerCase();
      const bLast = (b.lastName ?? '').toLowerCase();
      if (aLast < bLast) return -1;
      if (aLast > bLast) return 1;
      const aFirst = (a.firstName ?? '').toLowerCase();
      const bFirst = (b.firstName ?? '').toLowerCase();
      if (aFirst < bFirst) return -1;
      if (aFirst > bFirst) return 1;
      return 0;
    });
  }, [studentsQuery.data]);

  // Surface a load failure the same way the imperative catch did.
  const studentsQueryIsError = studentsQuery.isError;
  useEffect(() => {
    if (studentsQueryIsError) {
      console.error('Fetch students error:', studentsQuery.error);
      showToast.error('Could not load the student list. Refresh the page to try again.');
    }
  }, [studentsQueryIsError, studentsQuery.error]);

  // Build the assignment-specific problem list from assignment payload.
  const assignmentProblems = useMemo(() => {
    return problems ?? [];
  }, [problems]);

  // All assignment problems are visible.
  const visibleProblems = assignmentProblems;


  const {
    selectedIndex,
    setSelectedIndex,
    selectedStudent,
    selectedStudentId,
    selectedProblemId,
    handleSelectProblem,
    handleSelectChange,
  } = useReviewSelection({ students, visibleProblems });

  // Number keys 1-9 jump to that problem (matching the numbers in the list), unless
  // the user is typing in a field (comment box, grade input, student search, etc.).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (e.key >= '1' && e.key <= '9') {
        const problem = visibleProblems[Number(e.key) - 1];
        if (problem) {
          e.preventDefault();
          handleSelectProblem(problem.id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visibleProblems, handleSelectProblem]);

  // Review data (submissions + comments + problem grades) for the selected student:
  // the TanStack Query fetch, its cold-load flag, and refresher live in a hook.
  const { reviewData, reviewQueryIsError, reviewError, reviewFetching, refreshReview } =
    useReviewData(courseId, assignmentId, selectedStudentId);

  const {
    commentTexts,
    setCommentText,
    savingComments,
    deletingComments,
    commentTarget,
    setCommentTarget,
    saveComment,
    deleteComment,
  } = useComments({
    courseId,
    assignmentId,
    selectedStudentId,
    group: reviewData?.group,
    groupMembers: reviewData?.groupMembers,
  });

  const {
    problemGrades,
    gradeInputs,
    problemGradeErrors,
    savingProblemGrades,
    studentGradeStatuses,
    studentEarned,
    handleGradeInputChange,
    saveProblemGrade,
    setManualHold,
    overrideProblemGrade,
    gradeTarget,
    setGradeTarget,
    pendingGroupGrade,
    confirmGroupGrade,
    cancelGroupGrade,
  } = useProblemGrades({
    courseId,
    assignmentId,
    courseIsArchived,
    students,
    selectedStudent,
    assignmentProblems,
    reviewData,
    reviewQueryIsError,
    reviewError,
    group: reviewData?.group,
    groupMembers: reviewData?.groupMembers,
  });

  // All three loading flags previously flipped together; they track the cold load.
  const loadingSubmissions = reviewFetching;
  const loadingComments = reviewFetching;
  const loadingProblemGrades = reviewFetching;

  // Group assignment for the selected student => the workspace shows a "Submitted by"
  // column so staff can see which member made each attempt.
  const reviewIsGroup = !!reviewData?.isGroup;

  // Read-only review data derived straight from the query cache instead of being
  // mirrored into state by an effect. Empty for no selected student or a failed load
  // (the query data is then undefined).
  const submissions = useMemo<Record<string, SubmissionData>>(
    () => (selectedStudentId ? (reviewData?.submissions ?? {}) : {}),
    [selectedStudentId, reviewData],
  );

  // Comments grouped by problem id (every visible problem gets an entry, even if
  // empty). Optimistic add/delete update the review-data cache (see saveComment /
  // deleteComment), so this memo stays the single source of truth.
  const comments = useMemo<Record<string, DiscussionComment[]>>(() => {
    const grouped = Object.fromEntries(
      assignmentProblems.map((problem) => [problem.id, [] as DiscussionComment[]]),
    ) as Record<string, DiscussionComment[]>;
    if (!selectedStudentId || !reviewData) return grouped;
    for (const comment of reviewData.comments ?? []) {
      const problemId = comment.problemId;
      if (problemId && grouped[problemId]) grouped[problemId].push(comment);
    }
    return grouped;
  }, [assignmentProblems, reviewData, selectedStudentId]);

  // The whole assignment at a glance, for the strip. Both come from the grades already
  // loaded for this student, so neither needs a request of its own.
  const assignmentTotals = useMemo(() => {
    const totalPoints = assignmentProblems.reduce((sum, p) => sum + (p.maxPoints ?? 0), 0);
    const earned = assignmentProblems.reduce((sum, p) => sum + (problemGrades[p.id] ?? 0), 0);
    const graded = assignmentProblems.filter((p) => typeof problemGrades[p.id] === 'number').length;
    return { totalPoints, earned, graded, count: assignmentProblems.length };
  }, [assignmentProblems, problemGrades]);

  // The problem whose submissions are on screen; also the target of a grant action.
  const selectedProblem = useMemo(
    () =>
      selectedProblemId
        ? (visibleProblems.find((p) => p.id === selectedProblemId) ?? null)
        : (visibleProblems[0] ?? null),
    [selectedProblemId, visibleProblems],
  );

  const handleRerunSubmission = useCallback(
    async (submission: Submission) => {
      await rerunSubmission({ submission, setRerunning, fetchReviewData: refreshReview });
    },
    [refreshReview],
  );

  // Left/Right arrows page to the previous/next student (wrapping), unless the user is
  // typing in a field (so arrow keys still move the cursor there).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      const count = students.length;
      if (count === 0) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev <= 0 ? count - 1 : prev - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev >= count - 1 ? 0 : prev + 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // setSelectedIndex is a useState setter from useReviewSelection, so it is stable; the
    // linter cannot see that through the hook boundary.
  }, [students.length, setSelectedIndex]);

  const isStudentDataLoading = loadingSubmissions || loadingComments || loadingProblemGrades;

  useEffect(() => {
    if (isStudentDataLoading) {
      const timeoutId = setTimeout(() => {
        setShowStudentDataLoading(true);
      }, 150);

      return () => clearTimeout(timeoutId);
    }

    setShowStudentDataLoading(false);
    return undefined;
  }, [isStudentDataLoading]);

  // The panel is built around a selected student, so everything before there is one needs
  // saying out loud. It used to render an empty div: a course with nobody enrolled looked
  // identical to a page that had failed, and every cold load flashed blank first.
  const heading = (
    <h2 className="flex items-center gap-2 text-2xl font-semibold">
      <FileText className="h-6 w-6" /> Submissions
    </h2>
  );

  if (studentsQuery.isPending) {
    return (
      <div className="space-y-4">
        {heading}
        <DataTableLoading message="Loading students, please wait..." className="min-h-[320px]" />
      </div>
    );
  }

  if (studentsQueryIsError) {
    return (
      <div className="space-y-4">
        {heading}
        <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          Could not load the student list. Refresh the page to try again.
        </div>
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="space-y-4">
        {heading}
        <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          Nobody is enrolled in this course yet. Add students on the Roster tab, and their
          submissions will appear here.
        </div>
      </div>
    );
  }

  return (
    <div>
      {selectedStudent && (
        <div className="space-y-4">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-semibold">
              <FileText className="h-6 w-6" /> Submissions
            </h2>

            {/* One bar: who you are reviewing, when their work was due, which problem, and how
                the assignment is going. Divided into cells rather than spaced apart, so the
                regions read as parts of one control strip instead of loose groups. */}
            <div className="mt-4 flex flex-col divide-y rounded-md border xl:py-3 xl:flex-row xl:items-stretch xl:divide-x xl:divide-y-0">
              <div className="flex min-w-0 items-center px-4 py-2 xl:flex-auto xl:py-0">
              <StudentNavigator
                students={students}
                selectedIndex={selectedIndex}
                onSelectStudent={handleSelectChange}
                gradeStatuses={studentGradeStatuses}
                earnedByStudent={studentEarned}
                totalPoints={assignmentTotals.totalPoints}
                groupInfo={
                  reviewData
                    ? {
                        isGroupAssignment: reviewData.isGroupAssignment,
                        isGroup: !!reviewData.isGroup,
                        group: reviewData.group ?? null,
                        members: reviewData.groupMembers ?? [],
                        effective: reviewData.effective,
                      }
                    : null
                }
              />
              </div>
              <div className="flex min-w-0 items-center px-4 py-2 xl:flex-auto xl:py-0">
                <ProblemPicker
                  problems={visibleProblems}
                  selectedProblemId={selectedProblem?.id ?? null}
                  onSelect={handleSelectProblem}
                  grades={problemGrades}
                />
              </div>
              <StudentSchedule
                assignment={assignmentShell}
                effective={reviewData?.effective ?? null}
                loading={!assignmentShell}
                timezone={timezone}
              />
              {/* A cell each, so the strip's rules separate them the way they separate the
                  dates from the picker. They answer different questions: how much is done,
                  and how it is going. */}
              {/* Dropped first when the bar is tight: how many problems are graded is the
                  least load-bearing figure here, and the picker already shows it per problem. */}
              <div className="hidden min-w-0 items-center px-4 py-2 2xl:flex xl:flex-auto xl:py-0">
                <ProgressRing
                  label="Graded"
                  value={assignmentTotals.graded}
                  total={assignmentTotals.count}
                  srLabel={`${assignmentTotals.graded} of ${assignmentTotals.count} problems graded`}
                />
              </div>
              <div className="flex min-w-0 items-center px-4 py-2 xl:flex-auto xl:py-0">
                <ProgressRing
                  label="Assignment score"
                  value={assignmentTotals.earned}
                  total={assignmentTotals.totalPoints}
                  srLabel={`${assignmentTotals.earned} of ${assignmentTotals.totalPoints} points`}
                />
              </div>
            </div>
          </div>

          <div role="region" aria-labelledby="review-student-heading">
            {/* Names the panel with the selected student so the region is meaningful
                to screen readers; StudentNavigator's live region announces changes. */}
            <h3 id="review-student-heading" className="sr-only">
              Reviewing{' '}
              {`${selectedStudent.firstName ?? ''} ${selectedStudent.lastName ?? ''}`.trim() ||
                'this student'}
            </h3>
            {assignmentProblems.length === 0 ? (
              <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
                No problems have been added to this assignment yet.
              </div>
            ) : showStudentDataLoading ? (
              <DataTableLoading
                message="Loading submissions, please wait..."
                className="min-h-[320px]"
              />
            ) : (
              (() => {
                const selectedSubs = selectedProblem
                  ? extractSubs(submissions[selectedProblem.id])
                  : [];
                const selectedComments = selectedProblem ? comments[selectedProblem.id] || [] : [];

                // Staff can hand the selected student (or their group) extra attempts on the
                // selected problem, on top of the shared cap. It sits in the Submissions
                // panel header because that is what it acts on; floating above the layout it
                // competed for attention with the grade box and pointed at nothing.
                // Granting extra attempts only means something when there is a cap to add to.
                // `max: null` from the limit resolver is "unlimited", which a problem gets by
                // having a base of zero or less, so the button would promise nothing.
                const problemLimit = selectedProblem
                  ? reviewData?.problemLimits?.[selectedProblem.id]
                  : undefined;
                const hasSubmissionCap = problemLimit
                  ? problemLimit.max !== null
                  : (selectedProblem?.maxSubmissions ?? 0) > 0;

                const grantAction = selectedProblem && hasSubmissionCap ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Problem actions">
                        <MoreVertical className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={courseIsArchived}
                        onClick={() => setGrantDialogOpen(true)}
                      >
                        Grant extra submissions
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null;

                const workspace = (
                  <ProblemWorkspace
                    // The header shows the cap the SELECTED student is working against
                    // (base plus any grants), not just the shared base value.
                    problem={
                      selectedProblem
                        ? {
                            ...selectedProblem,
                            maxSubmissions:
                              reviewData?.problemLimits?.[selectedProblem.id]?.max ??
                              selectedProblem.maxSubmissions,
                          }
                        : null
                    }
                    submissions={selectedSubs}
                    assignmentDueDate={assignmentDueDate}
                    submissionsAction={grantAction}
                    gradedManually={
                      selectedProblem
                        ? (reviewData?.problemGrades?.[selectedProblem.id]?.gradedManually ?? false)
                        : false
                    }
                    onManualHoldChange={(held) =>
                      selectedProblem && void setManualHold(selectedProblem.id, held)
                    }
                    onOverrideGrade={(grade) =>
                      selectedProblem && void overrideProblemGrade(selectedProblem.id, grade)
                    }
                    showSubmitter={reviewIsGroup}
                    subjectName={
                      `${selectedStudent.firstName ?? ''} ${selectedStudent.lastName ?? ''}`.trim() ||
                      'this student'
                    }
                    commentAudience={
                      reviewData?.group
                        ? {
                            group: reviewData.group,
                            studentName:
                              `${selectedStudent.firstName ?? ''} ${selectedStudent.lastName ?? ''}`.trim() ||
                              'this student',
                            target: commentTarget,
                            onTargetChange: setCommentTarget,
                          }
                        : null
                    }
                    comments={selectedComments}
                    commentText={selectedProblem ? commentTexts[selectedProblem.id] || '' : ''}
                    onCommentTextChange={(text: string) =>
                      selectedProblem && setCommentText(selectedProblem.id, text)
                    }
                    onSaveComment={() => selectedProblem && saveComment(selectedProblem.id)}
                    onDeleteComment={(commentId: string) =>
                      selectedProblem && deleteComment(commentId)
                    }
                    isSaving={selectedProblem ? savingComments[selectedProblem.id] : false}
                    deletingComments={deletingComments}
                    onViewSubmission={(submission: ProblemSubmission) =>
                      setOpenDialog({ open: true, submission })
                    }
                    onRerunSubmission={(submission) =>
                      handleRerunSubmission(submission as unknown as Submission)
                    }
                    rerunning={rerunning}
                    courseIsArchived={courseIsArchived}
                    gradeInput={selectedProblem ? gradeInputs[selectedProblem.id] || '' : ''}
                    currentGrade={
                      selectedProblem ? (problemGrades[selectedProblem.id] ?? null) : null
                    }
                    gradeError={
                      selectedProblem ? problemGradeErrors[selectedProblem.id] || null : null
                    }
                    onGradeInputChange={(value) =>
                      selectedProblem && handleGradeInputChange(selectedProblem.id, value)
                    }
                    onSaveGrade={() => selectedProblem && saveProblemGrade(selectedProblem.id)}
                    isSavingGrade={
                      selectedProblem ? Boolean(savingProblemGrades[selectedProblem.id]) : false
                    }
                    isLoadingGrade={loadingProblemGrades}
                    groupGradeValue={
                      selectedProblem
                        ? (reviewData?.problemGrades?.[selectedProblem.id]?.groupGradeValue ?? null)
                        : null
                    }
                    gradeAudience={
                      reviewData?.group
                        ? {
                            group: reviewData.group,
                            studentName:
                              `${selectedStudent.firstName ?? ''} ${selectedStudent.lastName ?? ''}`.trim() ||
                              'this student',
                            target: gradeTarget,
                            onTargetChange: setGradeTarget,
                          }
                        : null
                    }
                    isPrivilegedUser={true}
                  />
                );

                // Stack on small screens; a fixed two-column layout on desktop.
                return <div className="min-w-0">{workspace}</div>;
              })()
            )}
          </div>
        </div>
      )}

      {selectedStudent && selectedProblem && grantMounted && (
        <GrantExtraSubmissionsDialog
          open={grantDialogOpen}
          setOpen={setGrantDialogOpen}
          courseId={courseId}
          assignmentId={assignmentId}
          problemId={selectedProblem.id}
          problemTitle={selectedProblem.title ?? null}
          student={{
            id: selectedStudent.id,
            name:
              `${selectedStudent.firstName ?? ''} ${selectedStudent.lastName ?? ''}`.trim() ||
              'this student',
          }}
          groupId={reviewData?.groupId ?? null}
          onGranted={refreshReview}
        />
      )}

      {/* Applying a group grade over members who already differ. Naming them and their
          current grades makes overwriting somebody's deliberate adjustment a decision rather
          than a side effect of a routine save. */}
      <ConfirmDialog
        open={!!pendingGroupGrade}
        title={`Overwrite ${pendingGroupGrade?.conflicts.length === 1 ? 'a grade' : 'grades'} in ${pendingGroupGrade?.groupName ?? 'this group'}?`}
        description={
          pendingGroupGrade ? (
            <>
              <span className="block">
                Giving {pendingGroupGrade.groupName} {pendingGroupGrade.grade} will replace what
                these members already have:
              </span>
              <ul className="mt-2 list-disc pl-5">
                {pendingGroupGrade.conflicts.map((c) => (
                  <li key={c.studentId}>
                    {c.name} currently has {c.grade}
                  </li>
                ))}
              </ul>
            </>
          ) : null
        }
        confirmText="Overwrite and apply"
        onConfirm={confirmGroupGrade}
        onCancel={cancelGroupGrade}
      />

      {openDialog.submission && (
        <SubmissionViewerDialog
          open={openDialog.open}
          onOpenChange={(open) => setOpenDialog({ open, submission: null })}
          problemType={visibleProblems.find((p) => p.id === selectedProblemId)?.type}
          src={apiPaths.files.submission(encodeURIComponent(openDialog.submission.fileName ?? ''))}
          title={`${openDialog.submission.originalFileName || openDialog.submission.fileName} - Submission`}
          epsSymbol={epsSymbol}
          width="70vw"
          height="70vh"
        />
      )}
    </div>
  );
}
