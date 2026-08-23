'use client';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/loading-spinner';
import {
  AlignLeft,
  BarChart3,
  BookOpen,
  FileText,
  Fingerprint,
  Package,
  Plus,
  Shapes,
  User,
  Users,
  SlidersHorizontal,
} from 'lucide-react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { IdentityPanel, IdentityPanelIcon } from '@/components/IdentityPanel';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { showToast } from '@/lib/toast';
import { AssignmentTypeCard } from '@/components/assignments/AssignmentTypeCard';
import { AssignmentBasicsForm } from '@/components/assignments/AssignmentBasicsForm';
import { AssignmentStatisticsPanel } from '@/components/assignments/AssignmentStatisticsPanel';
import { AssignmentSimilarityPanel } from '@/components/assignments/AssignmentSimilarityPanel';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TabBar, TabRail } from '@/components/course/course-tabs';
import { LocalNavLayout } from '@/components/local-nav';
import { useIsDesktopNav } from '@/hooks/use-desktop-nav';
import { useConfirmIfDirty } from '@/components/unsaved-changes/UnsavedChangesProvider';
import AssignmentSubmissions from '@/components/AssignmentSubmissions';
import Link from 'next/link';
import type { Prisma, Problem } from '@prisma/client';
import { useEmptyStringSymbol } from '@/hooks/use-empty-string-symbol';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import type { AssignmentWithDetails } from '@/lib/assignment-details';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import { queryKeys } from '@/lib/query-keys';
import { asRichDescription } from '@/lib/rich-description';
import { RichDescription } from '@/components/rich-description/RichDescription';
import { buildProblemColumns } from './problem-columns';
import { GradeSyncCard } from '@/components/assignments/GradeSyncCard';
import { LmsLinkBadge } from '@/components/lti/LmsLinkBadge';
import { AssignmentLmsLinksCard } from '@/components/lti/AssignmentLmsLinksCard';
import { fetchAssignmentLmsLinks, type AssignmentLmsLink } from '@/lib/lti/fetch-assignment-links';
import { TEXT_LINK_CLASS } from '@/lib/link-styles';
import { cn } from '@/lib/utils';

/**
 * The dialogs and the settings tab load on demand. Between them they were the only things
 * putting the form stack on this route, and none of them is on screen when the page opens: the
 * viewer needs a submission chosen, the settings card needs its tab selected, and the rest need
 * a menu item clicked.
 *
 * `ConfirmDialog` stays a normal import; it is small, has no form machinery, and is shared
 * app-wide, so splitting it would add a request without removing bytes.
 */
const AssociateProblemsDialog = dynamic(
  () =>
    import('@/components/dialogs/AssociateProblemsDialog').then((m) => m.AssociateProblemsDialog),
  { ssr: false },
);
const CreateProblemDialog = dynamic(
  () => import('@/components/dialogs/CreateProblemDialog').then((m) => m.CreateProblemDialog),
  { ssr: false },
);
const SubmissionViewerDialog = dynamic(
  () => import('@/components/dialogs/SubmissionViewerDialog').then((m) => m.SubmissionViewerDialog),
  { ssr: false },
);
const AssignmentProblemSettingsDialog = dynamic(
  () =>
    import('@/components/dialogs/AssignmentProblemSettingsDialog').then(
      (m) => m.AssignmentProblemSettingsDialog,
    ),
  { ssr: false },
);
const AssignmentSettingsCard = dynamic(
  () =>
    import('@/components/assignments/AssignmentSettingsCard').then((m) => m.AssignmentSettingsCard),
  {
    ssr: false,
    // This one fills the panel the author is looking at rather than appearing over it, so an
    // empty panel would read as a bug. Same reasoning as the course settings form.
    loading: () => <p className="text-muted-foreground text-sm">Loading assignment settings…</p>,
  },
);

/** True once `open` has first been true, so a dynamic import stays deferred until first use. */
function useMountedOnce(open: boolean): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return mounted || open;
}

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

// Sections that are a form get a readable measure; everything else is a table, a chart
// or a comparison and takes the full column.
const FORM_TABS = new Set(['description', 'type', 'assign-to', 'settings']);

type PrivilegeAssignmentViewProps = {
  initialAssignment?: AssignmentWithDetails | null;
  initialAssignments?: AssignmentSummary[];
};

export default function AssignmentDashboardPage({
  initialAssignment = null,
  initialAssignments,
}: PrivilegeAssignmentViewProps) {
  const { timezone } = useEffectiveTimezone();
  // xl rather than lg: a rail plus a submissions table needs the room.
  const railNav = useIsDesktopNav(1280);
  const { id, aid } = useParams<{ id: string; aid: string }>();
  const epsSymbol = useEmptyStringSymbol(id);
  const searchParams = useSearchParams();
  const router = useRouter();

  const queryClient = useQueryClient();
  const [problemToRemove, setProblemToRemove] = useState<Problem | null>(null);
  // Holds the requested publish state while the confirmation dialog is open.
  const [publishTarget, setPublishTarget] = useState<boolean | null>(null);
  const [addProblemDialogOpen, setAddProblemDialogOpen] = useState(false);
  const [createProblemOpen, setCreateProblemOpen] = useState(false);
  const associateMounted = useMountedOnce(addProblemDialogOpen);
  const createProblemMounted = useMountedOnce(createProblemOpen);
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

  // Invalidate the whole course->assignment prefix (the shell plus its sibling queries:
  // assignees, overrides, etc.) so a type change or audience edit doesn't leave the Assign
  // To tab reading stale sub-queries.
  const invalidateAssignment = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['course', id, 'assignment', aid] }),
    [queryClient, id, aid],
  );

  // Stable prop for the Assign To card. Built here (not inline in JSX) so unrelated parent
  // re-renders don't mint fresh Date objects, which would retrigger the card's reset() and
  // wipe unsaved edits. Recomputes only when the query data itself changes.
  const settingsAssignment = useMemo(() => {
    if (!assignment) return null;
    const toDate = (v: Date | string | null | undefined): Date | null =>
      v ? (typeof v === 'string' ? new Date(v) : v) : null;
    return {
      ...assignment,
      groupSetId: assignment.groupSetId ?? null,
      description: assignment.description ?? null,
      // Settings card edits dates/audience only, so the description fields are just carried
      // through to satisfy the Assignment type.
      descriptionFormat: assignment.descriptionFormat ?? ('PLAIN_TEXT' as const),
      descriptionJson: (assignment.descriptionJson ?? null) as Prisma.JsonValue,
      createdAt: assignment.createdAt ?? new Date(),
      updatedAt: assignment.updatedAt ?? new Date(),
      dueDate: toDate(assignment.dueDate) ?? new Date(),
      allowLateSubmissions: assignment.allowLateSubmissions ?? false,
      lateCutoff: toDate(assignment.lateCutoff),
      unlockAt: toDate(assignment.unlockAt),
      assignedToEveryone: assignment.assignedToEveryone ?? true,
      // Carried through like the description fields: the settings card does not edit it, but
      // the Assignment type requires it.
      ltiAutoSync: true,
    };
  }, [assignment]);

  const [descOpen, setDescOpen] = useState(false);
  // Both forms of the problem's description, so the dialog can render the rich one and fall
  // back to the plain text exactly like every other read surface.
  const [descTarget, setDescTarget] = useState<{
    description: string | null;
    descriptionJson: unknown;
  }>({ description: null, descriptionJson: null });
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
      showToast.error('This problem has no file to preview.');
      return;
    }
    const src = apiPaths.files.solution(encodeURIComponent(fileName));
    setViewerSrc(src);
    setViewerTitle(`${original || fileName} - ${problem.title}`);
    setViewerOpen(true);
    setJffType(problem.type);
  }, []);

  const openDescription = useCallback((problem: Problem) => {
    setDescTarget({
      description: problem.description ?? null,
      descriptionJson: (problem as { descriptionJson?: unknown }).descriptionJson ?? null,
    });
    setDescOpen(true);
  }, []);

  // Tab switches flip local state BEFORE the URL changes, unmounting the current tab's
  // content, so a router-level guard would fire too late: the edits are already gone. Ask
  // first. `confirmIfDirty` resolves true immediately when nothing is dirty, so the pristine
  // path is unchanged.
  const confirmIfDirty = useConfirmIfDirty();
  const handleTabChange = useCallback(
    (value: string) => {
      void confirmIfDirty().then((proceed) => {
        if (!proceed) return;
        setTab(value);
        const params = new URLSearchParams(searchParams.toString());
        params.set('tab', value);
        router.replace(`?${params.toString()}`);
      });
    },
    [confirmIfDirty, searchParams, router],
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
      fetch(apiPaths.courseAssignments(id, { includeUnpublished: true }))
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

  // Read 3: which LMS courses open this assignment. Held here rather than inside the settings
  // card because the header badge reads the same answer, and removing a link has to change
  // both at once.
  const lmsLinksQuery = useQuery({
    queryKey: ['course', id, 'assignment', aid, 'lms-links'],
    /**
     * A failure here is a failure, not an answer.
     *
     * This used to map any refusal or network error onto an empty list, so the card told
     * somebody "this assignment has not been added to a course in your LMS", which is a
     * statement about their LMS made from no information at all. Acting on it means adding a
     * second link for work that already has one. Throwing lets the card say it could not check.
     */
    queryFn: () => fetchAssignmentLmsLinks(id, aid),
    enabled: !!id && !!aid,
    staleTime: 30_000,
  });
  const lmsLinks = lmsLinksQuery.data ?? [];
  /**
   * The badge says an LMS opens this assignment, so it may only count links an LMS has opened.
   * A link the platform refused would otherwise put "In Canvas" on the header, which is the
   * same wrong claim in a smaller place. The card below gets all of them, because saying a link
   * is unconfirmed is the one screen that should.
   */
  const confirmedLmsLinks = lmsLinks.filter((link) => link.confirmedAt);

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
      showToast.added(problemIds.length === 1 ? 'Problem' : `${problemIds.length} problems`);
    } catch {
      showToast.error(
        `Could not add the ${problemIds.length === 1 ? 'problem' : 'problems'} to this assignment. Check your connection and try again.`,
      );
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
      showToast.removed('Problem', { name: problemToRemove.title });
    } catch {
      showToast.error(
        'Could not remove the problem from this assignment. Check your connection and try again.',
      );
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

  async function handlePublishChange(checked: boolean) {
    if (!id || !aid) return;
    try {
      await apiClient.put(apiPaths.assignment(id, aid), { isPublished: checked });
      await invalidateAssignment();
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'Failed to update publish state');
    }
  }

  // How many matches are worth a look, for the Similarity tab's count. Counts only, so it
  // discloses nothing about a student and writes no access entry; without it nobody in a
  // large course finds out there is anything to read without opening the tab on the off
  // chance.
  const similarityCountQuery = useQuery({
    queryKey: queryKeys.assignment.similarityCount(id, aid),
    queryFn: async () => {
      const res = await fetch(apiPaths.assignmentSimilarityCount(id, aid));
      if (!res.ok) throw new Error('Failed to fetch similarity counts');
      return (await res.json()) as { matches: number; notable: number; reusedAfterPass: number };
    },
    enabled: !!id && !!aid,
    staleTime: 60_000,
  });
  const notableMatches = similarityCountQuery.data?.notable ?? 0;

  if (loading) return <LoadingSpinner label="Loading" />;
  if (!assignment) return <div className="text-destructive p-6">Assignment not found.</div>;

  const assignmentProblemForDialog = problemToEdit
    ? ((assignment.problems ?? []).find((ap) => ap.problem.id === problemToEdit.id) ?? null)
    : null;

  const assignmentSettingsForDialog = assignmentProblemForDialog
    ? {
        maxPoints: assignmentProblemForDialog.maxPoints,
        maxSubmissions: assignmentProblemForDialog.maxSubmissions,
        autograderEnabled: assignmentProblemForDialog.autograderEnabled,
      }
    : undefined;

  // Single source of truth for the assignment tab strip and its mobile select
  // fallback, so the two stay in sync.
  const assignmentTabs = [
    { value: 'description', label: 'Details', Icon: AlignLeft },
    { value: 'type', label: 'Type', Icon: Shapes },
    { value: 'assign-to', label: 'Assign To', Icon: Users },
    { value: 'problems', label: 'Problems', Icon: FileText },
    { value: 'submissions', label: 'Submissions', Icon: Package },
    { value: 'statistics', label: 'Statistics', Icon: BarChart3 },
    {
      value: 'similarity',
      label: 'Similarity',
      Icon: Fingerprint,
      // No badge at zero: an empty count on every assignment trains people to ignore it.
      ...(notableMatches > 0 ? { count: notableMatches } : {}),
    },
    { value: 'settings', label: 'Settings', Icon: SlidersHorizontal },
  ] as const;

  return (
    <div className="mx-auto w-full text-sm">
      <Tabs
        value={tab}
        onValueChange={handleTabChange}
        orientation={railNav ? 'vertical' : 'horizontal'}
        // gap-4, not space-y-6. The Tabs primitive is `flex flex-col gap-2`, and a
        // space-y-* on top of that does not replace the gap, it ADDS to it: tailwind-merge
        // only reconciles classes that set the same property, and gap and margin are not
        // the same property. So the panel sat 8px + 24px = 32px above the workspace while
        // the navbar left only the layout's own 16px above it. One mechanism, one value.
        className="gap-4"
      >
        {/* The same identity panel the course page leads with, so an assignment reads as
            the same kind of object one level down. The shell, the wash and the arcs all
            come from the shared component; only what goes inside differs. */}
        <IdentityPanel labelledBy="assignment-page-title">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
            {/* min-w-0 flex-1 so a long title wraps rather than pushing the controls off
                the panel. Never truncated: this is the one place the whole title belongs. */}
            <h1
              id="assignment-page-title"
              className="flex min-w-0 flex-1 items-start gap-3 text-2xl leading-tight font-semibold tracking-tight"
            >
              {/* BookOpen, the icon the local rail and the course page already use for
                  assignments, in the identity panel's emerald tile. */}
              <IdentityPanelIcon icon={BookOpen} />
              <span className="min-w-0 [overflow-wrap:anywhere] break-words">
                {assignment.title}
              </span>
            </h1>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              {/* Publish toggle sits next to the title; server enforces the guards
                  (e.g. no unpublish after submissions). */}
              <label className="flex shrink-0 items-center gap-2 text-sm font-medium">
                <Switch
                  aria-label="Published"
                  checked={!!assignment.isPublished}
                  onCheckedChange={(checked) => setPublishTarget(!!checked)}
                  disabled={courseIsArchived}
                />
                Published
              </label>
              {/* Whether this is group work belongs to the assignment, so it is stated once
                  here rather than repeated beside every student on the Submissions tab. The
                  dates are NOT here on purpose: those resolve per student through date
                  overrides, so a single header value would hide an extension. */}
              {/* Tinted so it registers at a glance. The two tones differ to tell them apart,
                  not to say one is better: an icon carries the same distinction for anyone who
                  cannot separate the hues. */}
              <Badge
                variant="outline"
                className={`shrink-0 gap-1.5 text-xs font-normal ${
                  assignment.groupSetId
                    ? 'bg-status-warning-bg border-status-warning-border text-status-warning'
                    : 'bg-status-info-bg border-status-info-border text-status-info'
                }`}
              >
                {assignment.groupSetId ? (
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <User className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {assignment.groupSetId ? 'Group assignment' : 'Individual assignment'}
              </Badge>
              {/* Only when an LMS opens it, which is why the badge renders nothing otherwise.
                  Settings holds the detail and the way to remove one. */}
              <LmsLinkBadge links={confirmedLmsLinks} />
              {/* Quick jump to another assignment in this course. */}
              <div className="w-56 shrink-0">
                <SearchableSelect
                  items={allAssignments.map((a) => ({ id: a.id, label: a.title }))}
                  onSelect={(assignmentId) => {
                    // Switching assignments unmounts every form on this page; ask first when
                    // one of them holds pending edits.
                    void confirmIfDirty().then((proceed) => {
                      if (!proceed) return;
                      // Carry the current tab across the jump so switching assignments keeps
                      // you on the same view (e.g. staying on Submissions or Statistics).
                      const tabQuery = `?tab=${encodeURIComponent(tab)}`;
                      if (id) router.push(`/dashboard/courses/${id}/${assignmentId}${tabQuery}`);
                      // Without the course id there is no absolute path to push, so this
                      // falls back to a RELATIVE navigation resolved against the current
                      // URL. next/navigation's router has no relative form, which is what
                      // the lint rule below cannot express.
                      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                      else window.location.href = `${assignmentId}${tabQuery}`;
                    });
                  }}
                  placeholder={assignmentsLoading ? 'Loading…' : 'Switch assignment'}
                  searchPlaceholder="Search assignments..."
                  emptyStateText="No assignments found."
                  disabled={assignmentsLoading}
                />
              </div>
            </div>
          </div>
          {/* Indented to the title's text on wide screens, so the identity block reads as
              one column, matching the course panel. */}
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm sm:pl-[3.75rem]">
            {/* Show course name/code as a link to the course page (fallback to courseId) */}
            <Link
              href={`/dashboard/courses/${assignment.course?.id || assignment.courseId}`}
              className={cn(TEXT_LINK_CLASS, 'max-w-full break-all')}
            >
              {assignment.course?.name || assignment.courseName || assignment.courseId}
              {assignment.course?.code
                ? ` (${assignment.course.code})`
                : assignment.courseCode
                  ? ` (${assignment.courseCode})`
                  : ''}
            </Link>
          </div>
        </IdentityPanel>

        {/* Below xl this is a plain stack, so the strip sits above the panels as it did.
            At xl the rail takes a fixed column beside them. One control at a time: two
            tablists under one Tabs root would duplicate its ARIA wiring. */}
        {/* Form sections stay a readable measure; the data sections (Problems,
            Submissions, Statistics, Similarity) take the whole column, since they are
            tables, charts and comparisons. */}
        <LocalNavLayout
          contentClassName={cn(FORM_TABS.has(tab) && 'max-w-3xl')}
          nav={
            railNav ? (
              <TabRail
                tabs={assignmentTabs}
                ariaLabel="Assignment sections"
                menuLabel="Assignment Menu"
              />
            ) : (
              <TabBar
                ariaLabel="Assignment sections"
                selectId="assignment-tab-select"
                value={tab}
                onValueChange={handleTabChange}
                tabs={assignmentTabs}
              />
            )
          }
        >
          <TabsContent value="description">
            <div className="space-y-4">
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                <AlignLeft className="h-6 w-6" />
                Details
              </h2>
              <AssignmentBasicsForm
                courseId={id}
                assignmentId={assignment.id}
                initialTitle={assignment.title}
                initialDescription={assignment.description ?? ''}
                initialDescriptionJson={asRichDescription(assignment.descriptionJson)}
                courseIsArchived={courseIsArchived}
                onSaved={() => void invalidateAssignment()}
              />
            </div>
          </TabsContent>
          <TabsContent value="type">
            <AssignmentTypeCard
              courseId={id}
              assignmentId={assignment.id}
              groupSetId={assignment.groupSetId ?? null}
              courseIsArchived={courseIsArchived}
              onChanged={() => void invalidateAssignment()}
            />
          </TabsContent>
          <TabsContent
            value="problems"
            className="animate-fade-in-up transition-opacity duration-300"
          >
            <div className="space-y-4">
              <div className="flex w-full items-center justify-between">
                <h2 className="flex items-center gap-2 text-xl font-semibold">
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
                This assignment consists of the following problems. You may add an existing problem
                from this course using the <strong>Add Existing Problem</strong> button in the
                upper-right corner, or create a new problem using the{' '}
                <strong>Create Problem</strong> button.
              </p>
              <DataTable
                columns={problemColumns}
                data={problemTableData}
                tableLabel="Assignment problems table"
                defaultSorting={[{ id: 'title', desc: false }]}
                // Max States and Deterministic are niche; hide them by default. They
                // stay available through the Columns menu.
                defaultColumnVisibility={{ maxStates: false, isDeterministic: false }}
                emptyTitle="No problems on this assignment"
                emptyDescription="Add problems so students have something to solve."
                emptyIcon={FileText}
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
          <TabsContent value="statistics">
            <AssignmentStatisticsPanel />
          </TabsContent>
          <TabsContent value="similarity">
            <AssignmentSimilarityPanel />
          </TabsContent>
          <TabsContent value="settings">
            <div className="space-y-4">
              <GradeSyncCard assignmentId={aid} variant="settings" />
              <AssignmentLmsLinksCard
                courseId={id}
                assignmentId={aid}
                links={lmsLinks}
                loading={lmsLinksQuery.isLoading}
                failed={lmsLinksQuery.isError}
                onRetry={() => void lmsLinksQuery.refetch()}
                courseIsArchived={courseIsArchived}
                onRemoved={(linkId) =>
                  queryClient.setQueryData(
                    ['course', id, 'assignment', aid, 'lms-links'],
                    (current: AssignmentLmsLink[] | undefined) =>
                      (current ?? []).filter((link) => link.id !== linkId),
                  )
                }
              />
            </div>
          </TabsContent>

          <TabsContent value="assign-to">
            {settingsAssignment ? (
              <AssignmentSettingsCard
                courseId={id}
                courseIsArchived={courseIsArchived}
                // Edit the dates in the COURSE's zone (what the server stores them in).
                timeZone={assignment.course?.timezone ?? timezone}
                assignment={settingsAssignment}
                onSaved={() => {
                  void invalidateAssignment();
                }}
              />
            ) : null}
          </TabsContent>
        </LocalNavLayout>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Problem Description</DialogTitle>
          </DialogHeader>
          {/* asChild swaps the default <p> for a div, because a rich description can contain
              headings, lists, and rules, which are invalid inside a paragraph. Radix keeps the
              generated id and the dialog's aria-describedby pointing at this element either
              way, so the dialog stays described. */}
          <DialogDescription asChild>
            <div>
              {descTarget.description || descTarget.descriptionJson ? (
                <RichDescription
                  // Heading base: dialog title is an h2, so the description starts one level below it.
                  headingBaseLevel={3}
                  description={descTarget.description}
                  descriptionJson={descTarget.descriptionJson}
                />
              ) : (
                'No description.'
              )}
            </div>
          </DialogDescription>
          <DialogClose asChild>
            <Button variant="secondary">Close</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
      {associateMounted && (
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
      )}
      {createProblemMounted && (
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
      )}
      <ConfirmDialog
        open={!!problemToRemove}
        variant="destructive"
        title="Remove problem from assignment?"
        description={
          problemToRemove
            ? `"${problemToRemove.title}" is removed from this assignment. The problem itself stays in the course problem bank.`
            : undefined
        }
        confirmText="Remove problem"
        onConfirm={handleConfirmRemoveProblem}
        onCancel={() => setProblemToRemove(null)}
      />

      <ConfirmDialog
        open={publishTarget !== null}
        title={publishTarget ? 'Publish assignment?' : 'Unpublish assignment?'}
        description={
          publishTarget
            ? 'This assignment becomes visible to the students it is assigned to.'
            : 'Students will no longer see this assignment.'
        }
        confirmText={publishTarget ? 'Publish' : 'Unpublish'}
        onConfirm={async () => {
          const next = publishTarget;
          if (next === null) return;
          await handlePublishChange(next);
          setPublishTarget(null);
        }}
        onCancel={() => setPublishTarget(null)}
      />
      {problemToEdit && assignmentSettingsForDialog && (
        <AssignmentProblemSettingsDialog
          open={editProblemDialogOpen}
          setOpen={setEditProblemDialogOpen}
          courseId={id}
          assignmentId={aid}
          problemId={problemToEdit.id}
          problemTitle={problemToEdit.title}
          settings={assignmentSettingsForDialog}
          courseIsArchived={courseIsArchived}
          onSaved={() => {
            void invalidateAssignment();
          }}
        />
      )}
    </div>
  );
}
