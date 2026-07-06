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
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import SelectField from '@/components/ui/SelectField';
import { AssociateProblemsDialog } from '@/components/dialogs/AssociateProblemsDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { CfgViewerDialog } from '@/components/dialogs/CfgViewerDialog';
import { RegexViewerDialog } from '@/components/dialogs/RegexViewerDialog';
import { CreateProblemDialog } from '@/components/dialogs/CreateProblemDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { Controller, useForm } from 'react-hook-form';
import { showToast } from '@/lib/toast';
import { EditAssignmentDialog } from '@/components/dialogs/EditAssignmentDialog';
import { EditProblemDialog } from '@/components/dialogs/EditProblemDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AssignmentSubmissions from '@/components/AssignmentSubmissions';
import Link from 'next/link';
import { Problem } from '@prisma/client';
import JffViewerDialog from '@/components/JffViewerDialog';
import { useEmptyStringSymbol } from '@/lib/useEmptyStringSymbol';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { AssignmentWithDetails } from '@/lib/assignment-details';

const problemTypeLabels: Record<string, string> = {
  FA: 'Finite Automaton',
  PDA: 'Push-Down Automaton',
  CFG: 'Context-Free Grammar',
  RE: 'Regular Expression',
  TM: 'Turing Machine',
};

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

type PrivilegeAssignmentViewProps = {
  initialAssignment?: AssignmentWithDetails | null;
  initialAssignments?: AssignmentSummary[];
};

export default function AssignmentDashboardPage({
  initialAssignment = null,
  initialAssignments,
}: PrivilegeAssignmentViewProps) {
  const { control } = useForm({
    defaultValues: {
      assignmentSelect: initialAssignment?.id || '',
    },
  });
  const { data: session } = useSession();
  const { timezone } = useEffectiveTimezone();
  const { id, aid } = useParams<{ id: string; aid: string }>();
  const epsSymbol = useEmptyStringSymbol(id);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Use a more flexible type for assignment to allow course details if available
  const [assignment, setAssignment] = useState<AssignmentWithDetails | null>(initialAssignment);
  const [allAssignments, setAllAssignments] = useState<AssignmentSummary[]>(initialAssignments ?? []);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [allProblems, setAllProblems] = useState<Problem[]>([]);
  const [problemsLoading, setProblemsLoading] = useState(false);
  const [problemToRemove, setProblemToRemove] = useState<Problem | null>(null);
  const [editAssignmentOpen, setEditAssignmentOpen] = useState(false);
  const [addProblemDialogOpen, setAddProblemDialogOpen] = useState(false);
  const [createProblemOpen, setCreateProblemOpen] = useState(false);
  const [editProblemDialogOpen, setEditProblemDialogOpen] = useState(false);
  const [problemToEdit, setProblemToEdit] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(!initialAssignment);
  const [problemsTabLoading, setProblemsTabLoading] = useState(false);
  const [tab, setTab] = useState(searchParams.get('tab') || 'problems');

  // Group mapping support (for group assignments)
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupProblemsMap, setGroupProblemsMap] = useState<Record<string, string[]>>({});
  const [descOpen, setDescOpen] = useState(false);
  const [descText, setDescText] = useState<string | null>(null);
  const courseIsArchived = assignment?.course?.isArchived ?? false;
  const canManageProblems = ['ADMIN', 'FACULTY', 'TA'].includes(session?.user?.role ?? '');

  // JFLAP viewer dialog state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState<string | undefined>(undefined);
  const [jffType, setJffType] = useState<string | null>(null);

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
    setJffType(problem.type);
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
    const shouldLoadProblems = tab === 'problems' || addProblemDialogOpen || createProblemOpen;
    if (!shouldLoadProblems) return;
    void fetchProblems();
  }, [fetchProblems, tab, addProblemDialogOpen, createProblemOpen]);

  const fetchAssignments = useCallback(() => {
    if (!id) return Promise.resolve();
    setAssignmentsLoading(true);
    return fetch(`/api/courses/${id}/assignments`)
      .then((res) => res.json())
      .then((data) =>
        setAllAssignments(
          Array.isArray(data)
            ? data.map((assignment: { id: string; title: string }) => ({
                id: assignment.id,
                title: assignment.title,
              }))
            : [],
        ),
      )
      .catch(() => setAllAssignments([]))
      .finally(() => setAssignmentsLoading(false));
  }, [id]);

  useEffect(() => {
    if (allAssignments.length === 0) {
      void fetchAssignments();
    }
  }, [allAssignments.length, fetchAssignments]);

  const refreshAssignment = useCallback(
    async (
      view: 'full' | 'problems' | 'submissions' = 'full',
      surface: 'page' | 'inline' = 'page',
    ) => {
      if (!aid) return;
      const useInlineLoading = surface === 'inline' && view === 'problems';
      if (useInlineLoading) {
        setProblemsTabLoading(true);
        try {
          const res = await fetch(`/api/courses/${id}/${aid}?view=${view}`);
          if (!res.ok) throw new Error('Failed to fetch assignment');
          const data = (await res.json()) as AssignmentWithDetails;
          setAssignment(data);
        } catch {
        setAssignment(null);
        } finally {
          setProblemsTabLoading(false);
        }
      } else {
        if (!assignment?.id) {
          showToast.error("Failed to load assignment");
        } else {
          window.location.href = assignment?.id;
        }
      }
    },
    [aid, id],
  );

  useEffect(() => {
    if (initialAssignment) {
      setAssignment(initialAssignment);
      setLoading(false);
      return;
    }
    const initialView = tab === 'submissions' ? 'submissions' : 'problems';
    void refreshAssignment(initialView);
    // We intentionally avoid refetching assignment shell data on every tab switch.
    // The submissions tab fetches its own review payloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAssignment, refreshAssignment]);

  // When this is a group assignment, fetch groups and the mapping of problems -> groups
  useEffect(() => {
    if (!id || !aid || !assignment?.isGroup) {
      setGroups([]);
      setGroupProblemsMap({});
      return;
    }

    let aborted = false;
    const ac = new AbortController();
    async function fetchGroupsAndMappings() {
      setGroupsLoading(true);
      try {
        const [grRes, gpRes] = await Promise.all([
          fetch(`/api/courses/${id}/groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'list' }),
          }),
          fetch(`/api/courses/${id}/${aid}/group-problems`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'list' }),
          }),
        ]);

        if (!aborted) {
          if (grRes.ok) {
            const gr = await grRes.json();
            setGroups(Array.isArray(gr) ? gr : (gr.groups ?? []));
          } else {
            setGroups([]);
          }

          if (gpRes.ok) {
            const gp = await gpRes.json();
            const map: Record<string, string[]> = {};
            for (const g of gp.groups ?? []) map[g.id] = g.problemIds || [];
            setGroupProblemsMap(map);
          } else {
            setGroupProblemsMap({});
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Failed to fetch groups/mappings:', err);
        setGroups([]);
        setGroupProblemsMap({});
      } finally {
        if (!aborted) setGroupsLoading(false);
      }
    }

    fetchGroupsAndMappings();
    return () => {
      aborted = true;
      ac.abort();
      setGroupsLoading(false);
    };
  }, [id, aid, assignment?.isGroup]);

  async function handleAddProblems(
    problemIds: string[],
    groupId?: string,
    problemSettings?: {
      problemId: string;
      maxPoints: number;
      maxSubmissions: number;
      autograderEnabled: boolean;
    }[],
  ) {
    if (!id || !aid) return;
    if (!canManageProblems) return;
    try {
      const payload: {
        problemIds: string[];
        groupId?: string;
        problemSettings?: ProblemLinkSettings[];
      } = { problemIds };
      if (groupId) payload.groupId = groupId;
      if (problemSettings && problemSettings.length > 0) payload.problemSettings = problemSettings;

      const res = await fetch(`/api/courses/${id}/${aid}/add-problems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      showToast.success('Problem Added');
    } catch {
      showToast.error('Failed to add problems');
    }
    await refreshAssignment('problems', 'inline');
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
    await refreshAssignment('problems', 'inline');
    setProblemToRemove(null);
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

  // All hooks must run before any early return so their call order is stable.
  const groupNamesByProblemId = useMemo(() => {
    const namesById = new Map(groups.map((group) => [group.id, group.name]));
    const map: Record<string, string[]> = {};
    for (const [groupId, problemIds] of Object.entries(groupProblemsMap)) {
      const name = namesById.get(groupId) ?? groupId;
      for (const problemId of problemIds ?? []) {
        if (!map[problemId]) map[problemId] = [];
        map[problemId].push(name);
      }
    }
    return map;
  }, [groupProblemsMap, groups]);


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
    () =>
      (assignment?.problems ?? []).map((ap) => ({
        ...ap.problem,
        description: ap.problem.description ?? undefined,
        type: typeof ap.problem.type === 'string' ? ap.problem.type : undefined,
      })),
    [assignment?.problems],
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
      <Card className="relative mb-8">
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
        <CardHeader>
          <CardTitle role="heading" aria-level={1} className="flex min-w-0 flex-wrap items-start gap-2 text-2xl break-words">
            <span className="font-semibold">Assignment:</span>{' '}
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              {assignment.title}
            </span>
            {(() => {
              const pastDue = assignment.isPublished && new Date(assignment.dueDate) <= new Date();
              const variant = !assignment.isPublished ? 'warning' : pastDue ? 'danger' : 'success';
              const status = !assignment.isPublished ? 'Not Published' : pastDue ? 'Past Due' : 'Published';
              return <Badge variant={variant}>{status}</Badge>;
            })()}
          </CardTitle>
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
        <CardContent className="space-y-4">
          <div className="min-w-0">
            <span className="font-semibold">Description:</span>
            <p className="text-muted-foreground max-h-auto overflow-y-auto resize-y rounded-md border p-3 break-words whitespace-pre-wrap">
              {assignment.description ?? 'No description.'}
            </p>
          </div>
          <div className="max-w-xs">
          <Controller
            control={control}
            name="assignmentSelect"
            render={({ field }) => (
              <SelectField
                label="Assignment"
                name="assignmentSelect"
                id="assignmentSelect"
                value={field.value}
                onValueChange={(assignmentId) => {
                  field.onChange(assignmentId);
                  const selectedAssignment = allAssignments.find((a) => a.id === assignmentId) ?? null;

                  if (!selectedAssignment) {
                    showToast.error('Selected assignment not found');
                    return;
                  }

                  if (id) {
                    router.push(`/dashboard/courses/${id}/${selectedAssignment.id}`);
                  } else {
                    window.location.href = selectedAssignment.id;
                  }
                }}
                placeholder={assignmentsLoading ? 'Loading...' : 'Choose assignment'}
                disabled={assignmentsLoading}
                options={allAssignments.map((assignOption) => ({
                  value: assignOption.id,
                  label: assignOption.title,
                }))}
                className="w-full"
                triggerClassName="!h-8 text-xs"
              />
            )}
          />
          </div>
        </CardContent>
      </Card>
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList
          aria-label="Assignment sections"
          className="bg-card border-border h-12 w-full rounded-md border p-1 shadow-sm"
        >
          <TabsTrigger
            className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white flex-1"
            value="problems"
          >
            <FileText className="h-4 w-4" />
            Problems
          </TabsTrigger>
          <TabsTrigger
            className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white flex-1"
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
                <CardTitle
                  role="heading"
                  aria-level={2}
                  className="flex items-center gap-2 text-2xl"
                >
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
                          View Description
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      );
                    },
                    meta: { priority: 2 },
                    enableSorting: false,
                  },
                  // Group column: only present for group assignments
                  ...(assignment.isGroup
                    ? [
                        {
                          id: 'group',
                          header: 'Group',
                          cell: ({ row }: { row: { original: Problem } }) => {
                            const pid = row.original.id;
                            const names = groupNamesByProblemId[pid] ?? [];

                            if (names.length === 0)
                              return <span title="All students">All students</span>;

                            if (names.length === 1)
                              return (
                                <span className="truncate" title={names[0]}>
                                  {names[0]}
                                </span>
                              );
                            return (
                              <span className="truncate" title={names.join(', ')}>
                                {names[0]} (+{names.length - 1})
                              </span>
                            );
                          },
                          meta: { priority: 2 },
                          enableSorting: false,
                        },
                      ]
                    : []),
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
                    enableSorting: true,
                    sortingFn: (rowA, rowB, columnId) => {
                      const normalize = (val: unknown) => {
                        if (typeof val !== 'number') return Number.POSITIVE_INFINITY;
                        return val === -1 ? Number.POSITIVE_INFINITY : val;
                      };
                      const a = normalize(rowA.getValue(columnId));
                      const b = normalize(rowB.getValue(columnId));
                      return a === b ? 0 : a > b ? 1 : -1;
                    },
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
                    enableSorting: true,
                    sortingFn: (rowA, rowB, columnId) => {
                      const toNumber = (val: unknown) => {
                        if (typeof val === 'boolean') return val ? 1 : 0;
                        return -1;
                      };
                      const a = toNumber(rowA.getValue(columnId));
                      const b = toNumber(rowB.getValue(columnId));
                      return a === b ? 0 : a > b ? 1 : -1;
                    },
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
                            aria-label={`Render file for ${row.original.title}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button asChild variant="secondary" size="sm">
                            <a
                              href={fileUrl}
                              download={fileName}
                              title={`Download ${fileName}`}
                              aria-label={`Download ${fileName} for ${row.original.title}`}
                            >
                              <Download className="h-4 w-4" aria-hidden="true" />
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
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-label={`Manage problem ${row.original.title}`}
                          >
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
                data={problemTableData}
                loading={problemsTabLoading || groupsLoading}
                tableLabel="Assignment problems table"
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
            problems={submissionTabProblems}
            assignmentIsGroup={assignment.isGroup ?? false}
            groups={groups}
            groupProblemsMap={groupProblemsMap}
          />
        </TabsContent>
      </Tabs>
      {/* JFLAP Viewer Dialog */}
      {viewerOpen && viewerSrc && ['FA', 'PDA', 'TM'].includes(jffType ?? '') && (
        <JffViewerDialog
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          src={viewerSrc}
          title={viewerTitle}
          width="80vw"
          height="80vh"
          showGridDefault={true}
          epsSymbol={epsSymbol}
        />
      )}
      {viewerOpen && viewerSrc && 'RE' === jffType && (
        <RegexViewerDialog
          src={viewerSrc}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          title={viewerTitle}
        />
      )}
      {viewerOpen && viewerSrc && 'CFG' === jffType && (
        <CfgViewerDialog
          src={viewerSrc}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          title={viewerTitle}
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
        allProblems={allProblems.map((p: Problem) => ({
          ...p,
          description: p.description ?? undefined,
          type: typeof p.type === 'string' ? p.type : undefined,
        }))}
        usedProblems={usedProblems}
        onAddProblems={(selectedProblemIds, groupId, problemSettings) => {
          return handleAddProblems(selectedProblemIds, groupId, problemSettings);
        }}
      />
      <CreateProblemDialog
        open={createProblemOpen}
        setOpen={setCreateProblemOpen}
        courseId={id}
        courseIsArchived={courseIsArchived}
        assignmentId={aid}
        onCreated={async (created) => {
          await fetchProblems();
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
            isGroup: assignment.isGroup ?? false,
            allowLateSubmissions: assignment.allowLateSubmissions ?? false,
            lateCutoff: assignment.lateCutoff
              ? typeof assignment.lateCutoff === 'string'
                ? new Date(assignment.lateCutoff)
                : assignment.lateCutoff
              : null,
          }}
          onSave={() => {
            void refreshAssignment('problems', 'inline');
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
                  maxSubmissions: -1,
                  maxPoints: 100,
                  autograderEnabled: true,
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
            void refreshAssignment('problems', 'inline');
          }}
        />
      )}
    </div>
  );
}
