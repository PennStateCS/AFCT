'use client';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/loading-spinner';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  ChevronDown,
  Pencil,
  Trash2,
  NotebookText,
  FileText,
  Package,
  Eye,
  Download,
  Plus,
} from 'lucide-react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { AssociateProblemsDialog } from '@/components/dialogs/AssociateProblemsDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
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
import { EditAssignmentDialog } from '@/components/dialogs/EditAssignmentDialog';
import { EditProblemDialog } from '@/components/dialogs/EditProblemDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AssignmentSubmissions from '@/components/AssignmentSubmissions';
import Link from 'next/link';
import { Problem } from '@prisma/client';
import JffViewerDialog from '@/components/JffViewerDialog';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date';

const problemTypeLabels: Record<string, string> = {
  // Add your problem type labels here
};

type AssignmentProblemLink = {
  problem: Problem;
  maxPoints: number;
  maxSubmissions: number;
  autograderEnabled: boolean;
};

type AssignmentWithDetails = {
  id: string;
  title: string;
  description?: string | null;
  courseId: string;
  courseName?: string;
  courseCode?: string;
  courseIsArchived?: boolean;
  dueDate: string | Date;
  maxPoints: number;
  isPublished: boolean;
  allowLateSubmissions?: boolean;
  lateCutoff?: string | Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  problems: AssignmentProblemLink[];
  course?: {
    id: string;
    name: string;
    code?: string;
    isArchived?: boolean;
  };
};

type ProblemLinkSettings = {
  problemId: string;
  maxPoints: number;
  maxSubmissions: number;
  autograderEnabled: boolean;
};

export default function AssignmentDashboardPage() {
  const { data: session } = useSession();
  const { timezone } = useEffectiveTimezone();
  const { id, aid } = useParams<{ id: string; aid: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Use a more flexible type for assignment to allow course details if available
  const [assignment, setAssignment] = useState<AssignmentWithDetails | null>(null);
  const [allProblems, setAllProblems] = useState<Problem[]>([]);
  const [problemsLoading, setProblemsLoading] = useState(false);
  const [problemToRemove, setProblemToRemove] = useState<Problem | null>(null);
  const [editAssignmentOpen, setEditAssignmentOpen] = useState(false);
  const [addProblemDialogOpen, setAddProblemDialogOpen] = useState(false);
  const [createProblemOpen, setCreateProblemOpen] = useState(false);
  const [editProblemDialogOpen, setEditProblemDialogOpen] = useState(false);
  const [problemToEdit, setProblemToEdit] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState(searchParams.get('tab') || 'problems');
  const [descOpen, setDescOpen] = useState(false);
  const [descText, setDescText] = useState<string | null>(null);
  const courseIsArchived = assignment?.course?.isArchived ?? false;
  const canManageProblems = ['ADMIN', 'FACULTY', 'TA'].includes(session?.user?.role ?? '');

  // JFLAP viewer dialog state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState<string | undefined>(undefined);

  // Allow optional file fields even if not in generated Prisma type
  type ProblemFileFields = Problem & { fileName?: string | null; originalFileName?: string | null };

  const openRenderViewer = (problem: Problem) => {
    const p = problem as ProblemFileFields;
    const fileName = p.fileName ?? null;
    const original = p.originalFileName ?? null;
    if (!fileName) {
      showToast.error('No file available to render');
      return;
    }
    const src = `/api/solutions/${encodeURIComponent(fileName)}`;
    setViewerSrc(src);
    setViewerTitle(`${original || fileName} - ${problem.title}`);
    setViewerOpen(true);
  };

  const openDescription = (text: string | null) => {
    setDescText(text);
    setDescOpen(true);
  };

  const handleTabChange = useCallback(
    (value: string) => {
      setTab(value);
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', value);
      router.replace(`?${params.toString()}`);
    },
    [searchParams, router],
  );

  const fetchProblems = useCallback(() => {
    if (!id) return Promise.resolve();
    setProblemsLoading(true);
    return fetch(`/api/courses/${id}/problems`)
      .then((res) => res.json())
      .then((data) => setAllProblems(Array.isArray(data) ? data : []))
      .catch(() => setAllProblems([]))
      .finally(() => setProblemsLoading(false));
  }, [id]);

  useEffect(() => {
    fetchProblems();
  }, [fetchProblems]);

  useEffect(() => {
    if (!aid) return;
    setLoading(true);
    fetch(`/api/courses/${id}/${aid}`)
      .then((res) => res.json())
      .then((data) => setAssignment(data))
      .catch(() => setAssignment(null))
      .finally(() => setLoading(false));
  }, [id, aid]);

  const isProblemSettingsArray = (
    payload: string[] | ProblemLinkSettings[],
  ): payload is ProblemLinkSettings[] =>
    Array.isArray(payload) && payload.length > 0 && typeof payload[0] === 'object';

  async function handleAddProblems(problemPayload: string[] | ProblemLinkSettings[]) {
    if (!id || !aid) return;
    if (!canManageProblems) return;
    let problemIds: string[] = [];
    let problemSettings: ProblemLinkSettings[] | undefined;

    if (isProblemSettingsArray(problemPayload)) {
      problemSettings = problemPayload;
      problemIds = problemPayload.map((cfg) => cfg.problemId);
    } else {
      problemIds = problemPayload;
    }

    const requestBody: Record<string, unknown> = { problemIds };
    if (problemSettings?.length) {
      requestBody.problemSettings = problemSettings;
    }
    try {
      const res = await fetch(`/api/courses/${id}/${aid}/add-problems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!res.ok) throw new Error();
      showToast.success('Problems added');
    } catch {
      showToast.error('Failed to add problems');
    }
    setLoading(true);
    fetch(`/api/courses/${id}/${aid}`)
      .then((res) => res.json())
      .then((data) => setAssignment(data))
      .finally(() => setLoading(false));
  }

  async function handleConfirmRemoveProblem() {
    if (!id || !aid || !problemToRemove) return;
    try {
      const res = await fetch(`/api/courses/${id}/${aid}/remove-problem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problemId: problemToRemove.id }),
      });
      if (!res.ok) throw new Error();
      showToast.success(`"${problemToRemove.title}" removed from assignment`);
    } catch {
      showToast.error(`Failed to remove "${problemToRemove.title}"`);
    }
    setLoading(true);
    fetch(`/api/courses/${id}/${aid}`)
      .then((res) => res.json())
      .then((data) => setAssignment(data))
      .finally(() => {
        setProblemToRemove(null);
        setLoading(false);
      });
  }

  const handleEditAssignment = () => setEditAssignmentOpen(true);
  const handleAddExistingProblem = () => setAddProblemDialogOpen(true);
  const handleCreateProblem = () => setCreateProblemOpen(true);
  const handleEditProblem = (problem: Problem) => {
    const problemWithCourseId = {
      ...problem,
      courseId: id,
    };
    setProblemToEdit(problemWithCourseId);
    setEditProblemDialogOpen(true);
  };

  if (loading) return <LoadingSpinner label="Loading" />;
  if (!assignment) return <div className="p-6 text-red-500">Assignment not found.</div>;

  const estimatedProblemPoints = Math.max(
    1,
    Math.round((assignment.maxPoints || 100) / Math.max(assignment.problems.length || 1, 1)),
  );

  const assignmentProblemForDialog = problemToEdit
    ? (assignment.problems.find((ap) => ap.problem.id === problemToEdit.id) ?? null)
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
      <div className="bg-card relative mb-8 w-full space-y-6 rounded-lg border p-6 shadow">
        <Button
          variant="default"
          aria-label="Edit Assignment"
          onClick={handleEditAssignment}
          className="absolute top-6 right-6"
          hidden={courseIsArchived}
        >
          <Pencil className="mr-2 h-4 w-4" />
          Edit Assignment
        </Button>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl">
              <span className="font-semibold">Assignment:</span> {assignment.title}
            </h1>
            {(() => {
              let status = '';
              let badgeClass = '';

              if (assignment.isPublished) {
                if (new Date(assignment.dueDate) <= new Date()) {
                  status = 'Past Due';
                  badgeClass = 'border-red-200 bg-red-50 text-red-700';
                } else {
                  status = 'Published';
                  badgeClass = 'border-green-200 bg-green-50 text-green-700';
                }
              } else {
                status = 'Not Published';
                badgeClass = 'border-yellow-200 bg-yellow-50 text-yellow-700';
              }

              return (
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${badgeClass}`}
                >
                  {status}
                </span>
              );
            })()}
          </div>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
            {/* Show course name/code as a link to the course page (fallback to courseId) */}
            <Link
              href={`/dashboard/courses/${assignment.course?.id || assignment.courseId}`}
              className="text-blue-700 hover:underline"
            >
              {assignment.course?.name || assignment.courseName || assignment.courseId}
              {assignment.course?.code
                ? ` (${assignment.course.code})`
                : assignment.courseCode
                  ? ` (${assignment.courseCode})`
                  : ''}
            </Link>
          </div>
          <div className="text-muted-foreground mt-1 text-sm">
            <span className="font-semibold">Due:</span>{' '}
            {formatDateTimeInTimeZone(assignment.dueDate, timezone)}
          </div>
        </div>
        <div>
          <span className="font-semibold">Description:</span>
          <br /> {assignment.description ?? 'No description.'}
        </div>
      </div>
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="bg-card border-border h-12 rounded-md border p-1 shadow-sm">
          <TabsTrigger
            className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white"
            value="problems"
          >
            <FileText className="h-4 w-4" />
            Problems
          </TabsTrigger>
          <TabsTrigger
            className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white"
            value="submissions"
          >
            <Package className="h-4 w-4" />
            Submissions
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="problems"
          className="animate-fade-in-up transition-opacity duration-300"
        >
          <Card className="w-full">
            <CardHeader className="text-2xl">
              <div className="flex w-full items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <FileText className="h-6 w-6" />
                  Problems
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="default"
                    aria-label="Create Problem"
                    onClick={handleCreateProblem}
                    disabled={problemsLoading || !canManageProblems}
                    hidden={courseIsArchived || !canManageProblems}
                  >
                    <Plus />
                    Create Problem
                  </Button>
                  <Button
                    variant="default"
                    aria-label="Add Existing Problem"
                    onClick={handleAddExistingProblem}
                    disabled={problemsLoading || !canManageProblems}
                    hidden={courseIsArchived || !canManageProblems}
                  >
                    <Plus />
                    Add Existing Problem
                  </Button>
                </div>
              </div>
              <p
                className="text-muted-foreground mt-2 max-w-3xl text-sm text-balance"
                hidden={courseIsArchived}
              >
                This assignment consists of the following problems. You may add an existing problem
                from this course using the <strong>Add Existing Problem</strong> button in the
                upper-right corner, or create a new problem using the{' '}
                <strong>Create Problem</strong> button.
              </p>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={[
                  {
                    id: 'number',
                    header: '#',
                    cell: ({ row }: { row: { index: number } }) => row.index + 1,
                    meta: { priority: 1 },
                    enableSorting: false,
                  },
                  {
                    accessorKey: 'title',
                    header: 'Title',
                    cell: ({ row }: { row: { original: Problem } }) => row.original.title,
                    meta: { priority: 1 },
                    enableSorting: true,
                  },
                  {
                    id: 'description_col',
                    header: 'Description',
                    cell: ({ row }: { row: { original: Problem } }) => {
                      const desc = row.original.description;
                      return desc ? (
                        <button
                          type="button"
                          onClick={() => openDescription(desc)}
                          className="text-blue-600 underline hover:text-blue-800"
                          title="View description"
                        >
                          View
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      );
                    },
                    meta: { priority: 2 },
                    enableSorting: false,
                  },
                  {
                    accessorKey: 'type',
                    header: 'Type',
                    cell: ({ row }: { row: { original: Problem } }) =>
                      problemTypeLabels[row.original.type as string] || row.original.type,
                    meta: { priority: 1 },
                    enableSorting: true,
                  },
                  {
                    accessorKey: 'maxStates',
                    header: 'Max States',
                    cell: ({ row }: { row: { original: Problem } }) =>
                      row.original.maxStates === -1 ? 'Unlimited' : row.original.maxStates,
                    meta: { priority: 2 },
                    enableSorting: true,
                  },
                  {
                    accessorKey: 'assignmentMaxPoints',
                    header: 'Max Points',
                    cell: ({
                      row,
                    }: {
                      row: { original: Problem & { assignmentMaxPoints?: number } };
                    }) =>
                      typeof row.original.assignmentMaxPoints === 'number'
                        ? row.original.assignmentMaxPoints
                        : '—',
                    meta: { priority: 1 },
                    enableSorting: true,
                  },
                  {
                    accessorKey: 'assignmentMaxSubmissions',
                    header: 'Max Submissions',
                    cell: ({
                      row,
                    }: {
                      row: { original: Problem & { assignmentMaxSubmissions?: number } };
                    }) => {
                      const value = row.original.assignmentMaxSubmissions;
                      if (typeof value !== 'number') return '—';
                      return value === -1 ? 'Unlimited' : value;
                    },
                    meta: { priority: 1 },
                    enableSorting: false,
                  },
                  {
                    accessorKey: 'assignmentAutograderEnabled',
                    header: 'Autograder',
                    cell: ({
                      row,
                    }: {
                      row: { original: Problem & { assignmentAutograderEnabled?: boolean } };
                    }) => {
                      const value = row.original.assignmentAutograderEnabled;
                      if (typeof value !== 'boolean') return '—';
                      return value ? 'On' : 'Off';
                    },
                    meta: { priority: 2 },
                    enableSorting: false,
                  },
                  {
                    accessorKey: 'isDeterministic',
                    header: 'Deterministic',
                    cell: ({ row }: { row: { original: Problem } }) =>
                      row.original.isDeterministic ? 'Yes' : 'No',
                    meta: { priority: 2 },
                    enableSorting: true,
                  },
                  {
                    id: 'answerFile',
                    header: 'Solution File',
                    cell: ({ row }: { row: { original: Problem } }) => {
                      const fileUrl = row.original.fileName
                        ? `/api/solutions/${row.original.fileName}?download=1`
                        : null;
                      const fileName = row.original.originalFileName || 'Download';
                      return fileUrl ? (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => openRenderViewer(row.original)}
                            title="Render file"
                            aria-label="Render file"
                          >
                            <Eye className="h-4 w-4" />
                            <span>View</span>
                          </Button>
                          <Button asChild variant="secondary" size="sm">
                            <a
                              href={fileUrl}
                              download={fileName}
                              title={`Download ${fileName}`}
                              aria-label={`Download ${fileName}`}
                            >
                              <Download className="h-4 w-4" aria-hidden="true" />
                              <span>Download</span>
                            </a>
                          </Button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">No file</span>
                      );
                    },
                    meta: { priority: 2 },
                    enableSorting: false,
                  },
                  {
                    id: 'actions',
                    header: 'Actions',
                    cell: ({ row }: { row: { original: Problem } }) => (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="secondary" size="sm">
                            <ChevronDown className="mr-1 h-4 w-4" /> Manage
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel className="flex items-center gap-2">
                            <NotebookText className="h-4 w-4" />
                            {row.original.title}
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleEditProblem(row.original)}
                            className="flex items-center gap-2"
                            hidden={courseIsArchived}
                          >
                            <Pencil className="mr-2 h-4 w-4" /> Edit Problem
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => openRenderViewer(row.original)}
                            className="flex items-center gap-2"
                          >
                            <Eye className="mr-2 h-4 w-4" /> View File
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="flex items-center gap-2"
                            disabled={!row.original.fileName}
                            onClick={() => {
                              const url = row.original.fileName
                                ? `/api/solutions/${row.original.fileName}?download=1`
                                : null;
                              if (!url) return;
                              window.open(url, '_blank', 'noopener,noreferrer');
                            }}
                          >
                            <Download className="mr-2 h-4 w-4" /> Download File
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setProblemToRemove(row.original)}
                            className="flex items-center gap-2 text-red-600 focus:text-red-600"
                            hidden={courseIsArchived}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Remove Problem
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ),
                    meta: { priority: 1 },
                  },
                ]}
                data={assignment.problems.map((ap) => ({
                  ...ap.problem,
                  description: ap.problem.description ?? null,
                  assignmentMaxPoints: ap.maxPoints,
                  assignmentMaxSubmissions: ap.maxSubmissions,
                  assignmentAutograderEnabled: ap.autograderEnabled,
                }))}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="submissions">
          <AssignmentSubmissions
            courseIsArchived={courseIsArchived}
            courseId={id}
            assignmentId={aid}
            maxAssignmentGrade={assignment.maxPoints}
            problems={assignment.problems.map((ap) => ({
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
            }))}
          />
        </TabsContent>
      </Tabs>
      {/* JFLAP Viewer Dialog */}
      {viewerOpen && viewerSrc && (
        <JffViewerDialog
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          src={viewerSrc}
          title={viewerTitle}
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
        courseIsArchived={courseIsArchived}
        allProblems={allProblems.map((p: Problem) => ({
          ...p,
          description: p.description ?? undefined,
          type: typeof p.type === 'string' ? p.type : undefined,
        }))}
        usedProblems={assignment.problems.map((ap) => ({
          ...ap.problem,
          description: ap.problem.description ?? undefined,
          type: typeof ap.problem.type === 'string' ? ap.problem.type : undefined,
        }))}
        defaultMaxPoints={0}
        defaultMaxSubmissions={-1}
        defaultAutograderEnabled={true}
        onAddProblems={(problemSettings) => {
          if (problemSettings.length === 0) return;
          handleAddProblems(problemSettings);
        }}
      />
      <CreateProblemDialog
        open={createProblemOpen}
        setOpen={setCreateProblemOpen}
        courseId={id}
        courseIsArchived={courseIsArchived}
        onCreated={async (created) => {
          await fetchProblems();
          if (created?.id) {
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
      {assignment && (
        <EditAssignmentDialog
          courseIsArchived={courseIsArchived}
          open={editAssignmentOpen}
          setOpen={setEditAssignmentOpen}
          timeZone={timezone}
          assignment={{
            ...assignment,
            description: assignment.description ?? null,
            createdAt: assignment.createdAt ?? new Date(),
            updatedAt: assignment.updatedAt ?? new Date(),
            dueDate:
              typeof assignment.dueDate === 'string'
                ? new Date(assignment.dueDate)
                : assignment.dueDate,
            allowLateSubmissions:
              typeof assignment.allowLateSubmissions === 'boolean'
                ? assignment.allowLateSubmissions
                : true,
            lateCutoff: assignment.lateCutoff
              ? typeof assignment.lateCutoff === 'string'
                ? new Date(assignment.lateCutoff)
                : assignment.lateCutoff
              : null,
          }}
          onSave={() => {
            setLoading(true);
            fetch(`/api/courses/${id}/${aid}`)
              .then((res) => res.json())
              .then((data) => setAssignment(data))
              .finally(() => setLoading(false));
          }}
        />
      )}
      {problemToEdit && (
        <EditProblemDialog
          courseIsArchived={courseIsArchived}
          open={editProblemDialogOpen}
          setOpen={setEditProblemDialogOpen}
          assignmentSettings={assignmentSettingsForDialog}
          problem={
            problemToEdit
              ? {
                  ...problemToEdit,
                  description: problemToEdit.description ?? null,
                  // Preserve string type when present so FA/PDA fields render
                  type: typeof problemToEdit.type === 'string' ? problemToEdit.type : null,
                  maxStates: problemToEdit.maxStates ?? null,
                  isDeterministic:
                    (problemToEdit as Problem & { isDeterministic?: boolean }).isDeterministic ??
                    null,
                }
              : {
                  id: '',
                  title: '',
                  description: null,
                  fileName: null,
                  originalFileName: null,
                  type: null,
                  maxStates: null,
                  isDeterministic: null,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  courseId: '',
                }
          }
          onSaved={() => {
            setLoading(true);
            fetch(`/api/courses/${id}/${aid}`)
              .then((res) => res.json())
              .then((data) => setAssignment(data))
              .finally(() => setLoading(false));
          }}
        />
      )}
    </div>
  );
}
