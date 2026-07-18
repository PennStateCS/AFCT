'use client';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { AlignLeft, FileText, Package, Plus, Settings } from 'lucide-react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import React, { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { AssociateProblemsDialog } from '@/components/dialogs/AssociateProblemsDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { SubmissionViewerDialog } from '@/components/dialogs/SubmissionViewerDialog';
import { CreateProblemDialog } from '@/components/dialogs/CreateProblemDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { showToast } from '@/lib/toast';
import { AssignmentSettingsCard } from '@/components/assignments/AssignmentSettingsCard';
import { EditProblemDialog } from '@/components/dialogs/EditProblemDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TAB_BAR_LIST_CLASS, TAB_BAR_TRIGGER_CLASS } from '@/components/course/course-tabs';
import AssignmentSubmissions from '@/components/AssignmentSubmissions';
import Link from 'next/link';
import type { Problem } from '@prisma/client';
import { useEmptyStringSymbol } from '@/lib/useEmptyStringSymbol';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import type { AssignmentWithDetails } from '@/lib/assignment-details';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { buildProblemColumns } from './problem-columns';

type ProblemLinkSettings = {
  problemId: string;
  maxPoints: number;
  maxSubmissions: number;
  autograderEnabled: boolean;
};

type AssignmentSummary = {
  id: string;
  title: string;
};

// The "Add existing problem" picker wants optional (not nullable) description/type, so
// widen a DB problem row to that shape. Shared by its candidate and used-problem lists.
function normalizeProblem(p: Problem) {
  return {
    ...p,
    description: p.description ?? undefined,
    type: typeof p.type === 'string' ? p.type : undefined,
  };
}

type PrivilegeAssignmentViewProps = {
  initialAssignment?: AssignmentWithDetails | null;
  initialAssignments?: AssignmentSummary[];
};

export default function AssignmentDashboardPage({
  initialAssignment = null,
  initialAssignments,
}: PrivilegeAssignmentViewProps) {
  const { timezone } = useEffectiveTimezone();
  const { id, aid } = useParams<{ id: string; aid: string }>();
  const epsSymbol = useEmptyStringSymbol(id);
  const searchParams = useSearchParams();
  const router = useRouter();

  const queryClient = useQueryClient();
  const [problemToRemove, setProblemToRemove] = useState<Problem | null>(null);
  const [addProblemDialogOpen, setAddProblemDialogOpen] = useState(false);
  const [createProblemOpen, setCreateProblemOpen] = useState(false);
  const [editProblemDialogOpen, setEditProblemDialogOpen] = useState(false);
  const [problemToEdit, setProblemToEdit] = useState<Problem | null>(null);
  const [tab, setTab] = useState(searchParams.get('tab') || 'description');

  // Assignment shell, cached and keyed to this course/assignment via the shared
  // queryKeys.assignment.shell key, so this privileged view and the embedded
  // StudentNavigator (plus StudentAssignmentView / the max-points cell) dedupe onto
  // one read of the same ?view=problems payload instead of fetching it twice.
  // Seeded from the SSR-provided initialAssignment (view=problems shape) so there's
  // no refetch on mount when the server already sent it, and back-navigation is
  // warm. Mutations invalidate this key, triggering a background refetch that does
  // NOT blank the page; the previous data stays visible until the new payload
  // arrives.
  const assignmentQuery = useQuery({
    queryKey: queryKeys.assignment.shell(id, aid),
    queryFn: async () => {
      const res = await fetch(apiPaths.assignment(id, aid, { view: 'problems' }));
      if (!res.ok) throw new Error('Failed to fetch assignment');
      return (await res.json()) as AssignmentWithDetails;
    },
    initialData: initialAssignment ?? undefined,
    enabled: !!id && !!aid,
    staleTime: 30_000,
  });
  const assignment = assignmentQuery.data ?? null;
  const loading = assignmentQuery.isPending;

  const invalidateAssignment = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.assignment.shell(id, aid) }),
    [queryClient, id, aid],
  );

  const [descOpen, setDescOpen] = useState(false);
  const [descText, setDescText] = useState<string | null>(null);
  // This privileged view is only rendered for course staff (admin or the course's
  // FACULTY/TA), so problem-management actions are gated only on the archived state.
  const courseIsArchived = assignment?.course?.isArchived ?? false;

  // JFLAP viewer dialog state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState<string | undefined>(undefined);
  const [jffType, setJffType] = useState<string | null>(null);

  // Allow optional file fields even if not in generated Prisma type
  type ProblemFileFields = Problem & { fileName?: string | null; originalFileName?: string | null };

  // Stable identities so the memoized column defs below don't rebuild each render.
  const openRenderViewer = useCallback((problem: Problem) => {
    const p = problem as ProblemFileFields;
    const fileName = p.fileName ?? null;
    const original = p.originalFileName ?? null;
    if (!fileName) {
      showToast.error('No file available to render');
      return;
    }
    const src = apiPaths.files.solution(encodeURIComponent(fileName));
    setViewerSrc(src);
    setViewerTitle(`${original || fileName} - ${problem.title}`);
    setViewerOpen(true);
    setJffType(problem.type);
  }, []);

  const openDescription = useCallback((text: string | null) => {
    setDescText(text);
    setDescOpen(true);
  }, []);

  const handleTabChange = useCallback(
    (value: string) => {
      setTab(value);
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', value);
      router.replace(`?${params.toString()}`);
    },
    [searchParams, router],
  );

  // Read 1: all course problems (used by the problems tab and the add/create
  // dialogs). Only fetched when one of those surfaces needs it. On any failure
  // the queryFn returns [] (no toast), matching the previous .catch behavior.
  const problemsEnabled = tab === 'problems' || addProblemDialogOpen || createProblemOpen;
  // Reads the course's problems via ?view=problems and shares the course-detail
  // hook's ['course', id, 'problems'] cache entry, so the ProblemsCard and this
  // picker dedupe (one canonical way to list a course's problems).
  const problemsQuery = useQuery({
    queryKey: ['course', id, 'problems'],
    queryFn: async () => {
      const res = await fetch(apiPaths.course(id, { view: 'problems' }));
      if (!res.ok) throw new Error('Failed to fetch problems');
      return (await res.json()) as { problems?: Problem[] };
    },
    enabled: !!id && problemsEnabled,
    staleTime: 30_000,
  });
  const allProblems = problemsQuery.data?.problems ?? [];
  const problemsLoading = problemsEnabled && problemsQuery.isFetching;

  // Read 2: assignment list for the dropdown. Seeded from the SSR-provided
  // initialAssignments so there's no refetch on mount when the server sent it.
  const assignmentsQuery = useQuery({
    queryKey: ['course', id, 'assignments-list'],
    queryFn: () =>
      fetch(apiPaths.courseAssignments(id))
        .then((res) => res.json())
        .then((data) =>
          Array.isArray(data)
            ? data.map((a: { id: string; title: string }) => ({ id: a.id, title: a.title }))
            : [],
        )
        .catch(() => [] as AssignmentSummary[]),
    initialData: initialAssignments,
    enabled: !!id,
    staleTime: 30_000,
  });
  const allAssignments = assignmentsQuery.data ?? [];
  const assignmentsLoading = assignmentsQuery.isFetching;

  async function handleAddProblems(
    problemIds: string[],
    problemSettings?: {
      problemId: string;
      maxPoints: number;
      maxSubmissions: number;
      autograderEnabled: boolean;
    }[],
  ) {
    if (!id || !aid) return;
    try {
      const payload: {
        problemIds: string[];
        problemSettings?: ProblemLinkSettings[];
      } = { problemIds };
      if (problemSettings && problemSettings.length > 0) payload.problemSettings = problemSettings;

      const res = await fetch(apiPaths.assignmentProblems(id, aid), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      showToast.success('Problem Added');
    } catch {
      showToast.error('Failed to add problems');
    }
    await invalidateAssignment();
  }

  async function handleConfirmRemoveProblem() {
    if (!id || !aid || !problemToRemove) return;
    try {
      const res = await fetch(apiPaths.assignmentProblems(id, aid), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problemId: problemToRemove.id }),
      });
      if (!res.ok) throw new Error();
      showToast.success(`"${problemToRemove.title}" removed from assignment`);
    } catch {
      showToast.error(`Failed to remove "${problemToRemove.title}"`);
    }
    await invalidateAssignment();
    setProblemToRemove(null);
  }

  const handleAddExistingProblem = () => setAddProblemDialogOpen(true);
  const handleCreateProblem = () => setCreateProblemOpen(true);
  const handleEditProblem = useCallback(
    (problem: Problem) => {
      const problemWithCourseId = {
        ...problem,
        courseId: id,
      };
      setProblemToEdit(problemWithCourseId);
      setEditProblemDialogOpen(true);
    },
    [id],
  );

  const problemTableData = useMemo(
    () =>
      (assignment?.problems ?? []).map((ap) => ({
        ...ap.problem,
        description: ap.problem.description ?? null,
        assignmentMaxPoints: ap.maxPoints,
        assignmentMaxSubmissions: ap.maxSubmissions,
        assignmentAutograderEnabled: ap.autograderEnabled,
      })),
    [assignment?.problems],
  );

  const submissionTabProblems = useMemo(
    () =>
      (assignment?.problems ?? []).map((ap) => ({
        id: ap.problem.id,
        title: ap.problem.title,
        description: ap.problem.description ?? undefined,
        type: ap.problem.type ? String(ap.problem.type) : undefined,
        maxStates: ap.problem.maxStates ?? undefined,
        isDeterministic: ap.problem.isDeterministic ?? undefined,
        fileName: ap.problem.fileName ?? undefined,
        originalFileName: ap.problem.originalFileName ?? undefined,
        maxPoints: ap.maxPoints,
        maxSubmissions: ap.maxSubmissions,
        autograderEnabled: ap.autograderEnabled,
      })),
    [assignment?.problems],
  );

  const usedProblems = useMemo(
    () => (assignment?.problems ?? []).map((ap) => normalizeProblem(ap.problem)),
    [assignment?.problems],
  );

  // Memoized so the DataTable isn't handed a fresh column model on every render
  // (this view re-renders on tab/dialog state and every query settle). All closed-
  // over handlers are useCallback-stable.
  const problemColumns = useMemo(
    () =>
      buildProblemColumns({
        courseIsArchived,
        openDescription,
        openRenderViewer,
        handleEditProblem,
        onRemoveProblem: setProblemToRemove,
      }),
    [courseIsArchived, openDescription, openRenderViewer, handleEditProblem],
  );

  if (loading) return <LoadingSpinner label="Loading" />;
  if (!assignment) return <div className="p-6 text-red-500">Assignment not found.</div>;

  const assignmentProblemForDialog = problemToEdit
    ? ((assignment.problems ?? []).find((ap) => ap.problem.id === problemToEdit.id) ?? null)
    : null;

  const assignmentSettingsForDialog = assignmentProblemForDialog
    ? {
        assignmentId: aid,
        courseId: id,
        maxPoints: assignmentProblemForDialog.maxPoints,
        maxSubmissions: assignmentProblemForDialog.maxSubmissions,
        autograderEnabled: assignmentProblemForDialog.autograderEnabled,
      }
    : undefined;

  return (
    <div className="mx-auto w-full text-sm">
      <Tabs value={tab} onValueChange={handleTabChange}>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <CardTitle
                role="heading"
                aria-level={1}
                className="flex min-w-0 flex-wrap items-start gap-2 text-2xl break-words"
              >
                <span className="font-semibold">Assignment:</span>{' '}
                <span className="min-w-0 [overflow-wrap:anywhere] break-words">
                  {assignment.title}
                </span>
              </CardTitle>
              {/* Quick jump to another assignment in this course. */}
              <div className="w-56 shrink-0">
                <SearchableSelect
                  items={allAssignments.map((a) => ({ id: a.id, label: a.title }))}
                  onSelect={(assignmentId) => {
                    if (id) router.push(`/dashboard/courses/${id}/${assignmentId}`);
                    else window.location.href = assignmentId;
                  }}
                  placeholder={assignmentsLoading ? 'Loading…' : 'Switch assignment'}
                  searchPlaceholder="Search assignments..."
                  emptyStateText="No assignments found."
                  disabled={assignmentsLoading}
                />
              </div>
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
              {/* Show course name/code as a link to the course page (fallback to courseId) */}
              <Link
                href={`/dashboard/courses/${assignment.course?.id || assignment.courseId}`}
                className="max-w-full break-all text-blue-700 hover:underline"
              >
                {assignment.course?.name || assignment.courseName || assignment.courseId}
                {assignment.course?.code
                  ? ` (${assignment.course.code})`
                  : assignment.courseCode
                    ? ` (${assignment.courseCode})`
                    : ''}
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Tab selector, matching the underline style used on the course page. */}
            <TabsList aria-label="Assignment sections" className={TAB_BAR_LIST_CLASS}>
              <TabsTrigger className={TAB_BAR_TRIGGER_CLASS} value="description">
                <AlignLeft className="size-3.5 opacity-70" />
                Description
              </TabsTrigger>
              <TabsTrigger className={TAB_BAR_TRIGGER_CLASS} value="submissions">
                <Package className="size-3.5 opacity-70" />
                Submissions
              </TabsTrigger>
              <TabsTrigger className={TAB_BAR_TRIGGER_CLASS} value="problems">
                <FileText className="size-3.5 opacity-70" />
                Problems
              </TabsTrigger>
              <TabsTrigger className={TAB_BAR_TRIGGER_CLASS} value="settings">
                <Settings className="size-3.5 opacity-70" />
                Settings
              </TabsTrigger>
            </TabsList>
            <TabsContent value="description">
              <div className="space-y-4">
                <h2
                  role="heading"
                  aria-level={2}
                  className="flex items-center gap-2 text-2xl font-semibold"
                >
                  <AlignLeft className="h-6 w-6" />
                  Description
                </h2>
                <p className="text-muted-foreground min-h-32 resize-y overflow-y-auto rounded-md border p-3 break-words whitespace-pre-wrap">
                  {assignment.description ?? 'No description.'}
                </p>
              </div>
            </TabsContent>
            <TabsContent
              value="problems"
              className="animate-fade-in-up transition-opacity duration-300"
            >
              <div className="space-y-4">
                <div className="flex w-full items-center justify-between">
                  <h2
                    role="heading"
                    aria-level={2}
                    className="flex items-center gap-2 text-2xl font-semibold"
                  >
                    <FileText className="h-6 w-6" />
                    Problems
                  </h2>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="default"
                      aria-label="Create Problem"
                      onClick={handleCreateProblem}
                      disabled={problemsLoading}
                      hidden={courseIsArchived}
                    >
                      <Plus />
                      Create Problem
                    </Button>
                    <Button
                      variant="default"
                      aria-label="Add Existing Problem"
                      onClick={handleAddExistingProblem}
                      disabled={problemsLoading}
                      hidden={courseIsArchived}
                    >
                      <Plus />
                      Add Existing Problem
                    </Button>
                  </div>
                </div>
                <p
                  className="text-muted-foreground max-w-3xl text-sm text-balance"
                  hidden={courseIsArchived}
                >
                  This assignment consists of the following problems. You may add an existing
                  problem from this course using the <strong>Add Existing Problem</strong> button in
                  the upper-right corner, or create a new problem using the{' '}
                  <strong>Create Problem</strong> button.
                </p>
                <DataTable
                  columns={problemColumns}
                  data={problemTableData}
                  tableLabel="Assignment problems table"
                  defaultSorting={[{ id: 'title', desc: false }]}
                />
              </div>
            </TabsContent>
            <TabsContent value="submissions">
              <AssignmentSubmissions
                courseIsArchived={courseIsArchived}
                courseId={id}
                assignmentId={aid}
                maxAssignmentGrade={assignment.maxPoints}
                problems={submissionTabProblems}
              />
            </TabsContent>
            <TabsContent value="settings">
              <AssignmentSettingsCard
                courseId={id}
                courseIsArchived={courseIsArchived}
                // Edit the dates in the COURSE's zone (what the server stores them in).
                timeZone={assignment.course?.timezone ?? timezone}
                assignment={{
                  ...assignment,
                  groupSetId: null,
                  description: assignment.description ?? null,
                  createdAt: assignment.createdAt ?? new Date(),
                  updatedAt: assignment.updatedAt ?? new Date(),
                  dueDate:
                    typeof assignment.dueDate === 'string'
                      ? new Date(assignment.dueDate)
                      : assignment.dueDate,
                  allowLateSubmissions: assignment.allowLateSubmissions ?? false,
                  lateCutoff: assignment.lateCutoff
                    ? typeof assignment.lateCutoff === 'string'
                      ? new Date(assignment.lateCutoff)
                      : assignment.lateCutoff
                    : null,
                  unlockAt: assignment.unlockAt
                    ? typeof assignment.unlockAt === 'string'
                      ? new Date(assignment.unlockAt)
                      : assignment.unlockAt
                    : null,
                  assignedToEveryone: assignment.assignedToEveryone ?? true,
                }}
                onSaved={() => {
                  void invalidateAssignment();
                }}
              />
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>
      {/* Submission viewer dialog, keyed off the problem type. */}
      {viewerOpen && viewerSrc && (
        <SubmissionViewerDialog
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          problemType={jffType}
          src={viewerSrc}
          title={viewerTitle}
          epsSymbol={epsSymbol}
          width="80vw"
          height="80vh"
          showGridDefault={true}
        />
      )}
      {/* Description dialog */}
      <Dialog open={descOpen} onOpenChange={(v) => setDescOpen(v)}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Problem Description</DialogTitle>
          </DialogHeader>
          <DialogDescription>{descText ?? 'No description.'}</DialogDescription>
          <DialogClose asChild>
            <Button variant="secondary">Close</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
      <AssociateProblemsDialog
        open={addProblemDialogOpen}
        onClose={() => setAddProblemDialogOpen(false)}
        courseId={id}
        assignmentId={aid}
        courseIsArchived={courseIsArchived}
        allProblems={allProblems.map(normalizeProblem)}
        usedProblems={usedProblems}
        onAddProblems={(selectedProblemIds, problemSettings) => {
          return handleAddProblems(selectedProblemIds, problemSettings);
        }}
      />
      <CreateProblemDialog
        open={createProblemOpen}
        setOpen={setCreateProblemOpen}
        courseId={id}
        courseIsArchived={courseIsArchived}
        assignmentId={aid}
        onCreated={async (created) => {
          await queryClient.invalidateQueries({ queryKey: ['course', id, 'problems'] });
          if (created?.id && !aid) {
            await handleAddProblems([created.id]);
          }
        }}
      />
      <ConfirmDialog
        open={!!problemToRemove}
        title="Remove Problem from Assignment"
        description={
          problemToRemove
            ? `Are you sure you want to remove "${problemToRemove.title}" from this assignment?`
            : undefined
        }
        confirmText="Remove"
        cancelText="Cancel"
        onConfirm={handleConfirmRemoveProblem}
        onCancel={() => setProblemToRemove(null)}
      />
      {problemToEdit && (
        <EditProblemDialog
          courseIsArchived={courseIsArchived}
          open={editProblemDialogOpen}
          setOpen={setEditProblemDialogOpen}
          assignmentSettings={assignmentSettingsForDialog}
          // `problemToEdit` is always set here (guarded by the `&&` above).
          problem={{
            ...problemToEdit,
            description: problemToEdit.description ?? null,
            // Preserve string type when present so FA/PDA fields render
            type: typeof problemToEdit.type === 'string' ? problemToEdit.type : null,
            maxStates: problemToEdit.maxStates ?? null,
            isDeterministic:
              (problemToEdit as Problem & { isDeterministic?: boolean }).isDeterministic ?? null,
          }}
          onSaved={() => {
            void invalidateAssignment();
          }}
        />
      )}
    </div>
  );
}
