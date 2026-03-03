'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, MessageSquare, Check, X, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Submission, User } from '@prisma/client';
import { showToast } from '@/lib/toast';
import { Comment as DiscussionComment } from './DiscussionPanel';
import { ProblemListCard } from '@/components/assignments/ProblemListCard';
import ProblemDiscussionPanel from './ProblemDiscussionPanel';
import StudentNavigator from './StudentNavigator';
import JffViewerDialog from './JffViewerDialog';
import ProblemHeader from './ProblemHeader';
import ProblemGradeForm from './ProblemGradeForm';
import SubmissionActionsMenu from './SubmissionActionsMenu';
import WorkspacePanel from './WorkspacePanel';
import { RegexViewerDialog } from '@/components/dialogs/RegexViewerDialog';
import { CfgViewerDialog } from '@/components/dialogs/CfgViewerDialog';

type Person = Pick<User, 'firstName' | 'lastName' | 'id'>;

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
  problems?: Problem[];
  // When assignmentIsGroup is true the parent will pass `groups` and
  // `groupProblemsMap` so this component can show only the problems
  // assigned to the student's group (unassigned problems apply to all).
  assignmentIsGroup?: boolean;
  groups?: { id: string; name: string }[];
  groupProblemsMap?: Record<string, string[]>;
};

// Helpers
const extractSubs = (raw?: SubmissionData): Submission[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && 'submissions' in raw)
    return (raw as { submissions: Submission[] }).submissions;
  return [];
};

function SubmissionTable({
  submissions,
  onView,
  onRerun,
  rerunning,
  className = '',
}: {
  submissions: Submission[];
  onView: (submission: Submission) => void;
  onRerun: (submission: Submission) => void;
  rerunning: Record<string, boolean>;
  className?: string;
}) {
  if (!submissions.length) {
    return (
      <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
        No submissions yet.
      </div>
    );
  }

  const sorted = [...submissions].sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  );

  return (
    <div className={`overflow-hidden rounded-md border ${className}`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Submitted</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Feedback</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((s) => {
            return (
              <TableRow key={s.id} className="hover:bg-transparent">
                <TableCell>
                  <div className="flex flex-col">
                    <span>{new Date(s.submittedAt).toLocaleDateString()}</span>
                    <span className="text-muted-foreground text-xs">
                      {new Date(s.submittedAt).toLocaleTimeString()}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  {s.correct === true ? (
                    <div className="flex justify-center">
                      <Check className="h-4 w-4 text-green-600" />
                    </div>
                  ) : s.correct === false ? (
                    <div className="flex justify-center">
                      <X className="h-4 w-4 text-red-600" />
                    </div>
                  ) : (
                    <div className="text-muted-foreground flex items-center gap-2">
                      <Minus className="h-4 w-4" />
                      <span className="text-sm">Submitted</span>
                    </div>
                  )}
                </TableCell>
                <TableCell className="break-words whitespace-normal">
                  {s.feedback ? (
                    <span className="text-sm">{s.feedback}</span>
                  ) : (
                    <span className="text-muted-foreground text-sm">No feedback</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <SubmissionActionsMenu
                      submission={s}
                      rerunning={Boolean(rerunning[s.id])}
                      onView={onView}
                      onRerun={onRerun}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

type ProblemListProps = {
  problems: Problem[];
  submissions: Record<string, SubmissionData>;
  selectedProblemId: string | null;
  onSelect: (problemId: string) => void;
};

function ProblemList({ problems, submissions, selectedProblemId, onSelect }: ProblemListProps) {
  if (!problems.length) return null;
  const limitText = (value: string, max = 80) =>
    value.length > max ? `${value.slice(0, max - 1)}…` : value;

  const items = problems.map((problem, index) => ({
    id: problem.id,
    title: problem.title
      ? `Problem ${index + 1}: ${limitText(problem.title)}`
      : `Problem ${index + 1}`,
  }));

  const getBadgeContent = (problemId: string) => {
    const subs = extractSubs(submissions[problemId]);
    if (!subs.length) {
      return (
        <Badge
          variant="secondary"
          className="border-transparent bg-slate-100 text-[10px] font-medium text-slate-700"
        >
          0
        </Badge>
      );
    }

    const latest = [...subs].sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
    )[0];

    let label = `${subs.length} ${subs.length === 1 ? 'submission' : 'submissions'}`;
    let badgeClass = 'bg-slate-100 text-slate-700';

    if (latest?.correct === true) {
      label = `Correct · ${subs.length}`;
      badgeClass = 'bg-emerald-100 text-emerald-800';
    } else if (latest?.correct === false) {
      label = `Needs review · ${subs.length}`;
      badgeClass = 'bg-amber-100 text-amber-800';
    }

    return (
      <Badge
        variant="secondary"
        className={`border-transparent text-[10px] font-semibold ${badgeClass}`}
      >
        {label}
      </Badge>
    );
  };

  return (
    <ProblemListCard
      problems={items}
      selectedProblemId={selectedProblemId}
      onSelect={onSelect}
      getBadgeContent={getBadgeContent}
      title="Problems"
      description="Select a problem to review submissions and discussion."
      className="h-fit"
      scrollAreaClassName="max-h-[520px]"
    />
  );
}

function ProblemWorkspace({
  problem,
  submissions,
  comments,
  commentText,
  onCommentTextChange,
  onSaveComment,
  onDeleteComment,
  isSaving,
  deletingComments,
  onViewSubmission,
  onRerunSubmission,
  rerunning,
  courseIsArchived,
  gradeInput,
  currentGrade,
  gradeError,
  onGradeInputChange,
  onSaveGrade,
  isSavingGrade,
  isLoadingGrade,
}: {
  problem: Problem | null;
  submissions: Submission[];
  comments: DiscussionComment[];
  commentText: string;
  onCommentTextChange: (text: string) => void;
  onSaveComment: () => void;
  onDeleteComment: (id: string) => void;
  isSaving?: boolean;
  deletingComments?: Record<string, boolean>;
  onViewSubmission: (submission: Submission) => void;
  onRerunSubmission: (submission: Submission) => void;
  rerunning: Record<string, boolean>;
  courseIsArchived: boolean;
  gradeInput: string;
  currentGrade: number | null;
  gradeError?: string | null;
  onGradeInputChange: (value: string) => void;
  onSaveGrade: () => void;
  isSavingGrade: boolean;
  isLoadingGrade: boolean;
}) {
  if (!problem) {
    return (
      <Card>
        <CardContent className="text-muted-foreground p-6 text-sm">
          Select a problem to view submissions.
        </CardContent>
      </Card>
    );
  }

  const sanitizedCurrentGrade = typeof currentGrade === 'number' ? currentGrade : null;
  return (
    <Card className="print:border-0 print:shadow-none">
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <ProblemHeader
            title={problem.title}
            description={problem.description}
            type={problem.type}
            maxStates={problem.maxStates}
            isDeterministic={problem.isDeterministic}
            maxSubmissions={problem.maxSubmissions}
            autograderEnabled={problem.autograderEnabled}
          />

          <ProblemGradeForm
            value={gradeInput}
            currentGrade={sanitizedCurrentGrade}
            disabled={courseIsArchived}
            isSaving={isSavingGrade}
            isLoading={isLoadingGrade}
            error={gradeError}
            onChange={onGradeInputChange}
            onSubmit={onSaveGrade}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid items-stretch gap-4 lg:grid-cols-[60%_40%]">
          <WorkspacePanel title="Submissions" icon={<FileText className="h-4 w-4" />}>
            <SubmissionTable
              submissions={submissions}
              onView={onViewSubmission}
              onRerun={onRerunSubmission}
              rerunning={rerunning}
              className="h-full"
            />
          </WorkspacePanel>
          <WorkspacePanel title="Discussion" icon={<MessageSquare className="h-4 w-4" />}>
            <ProblemDiscussionPanel
              courseIsArchived={courseIsArchived}
              comments={comments}
              commentText={commentText}
              onCommentTextChange={onCommentTextChange}
              onSaveComment={onSaveComment}
              onDeleteComment={onDeleteComment}
              isSaving={isSaving}
              deletingComments={deletingComments}
            />
          </WorkspacePanel>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AssignmentSubmissions({
  courseIsArchived,
  courseId,
  assignmentId,
  problems,
  assignmentIsGroup = false,
  groups = [],
  groupProblemsMap = {},
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [students, setStudents] = useState<Person[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [submissions, setSubmissions] = useState<Record<string, SubmissionData>>({});
  const [comments, setComments] = useState<Record<string, DiscussionComment[]>>({});
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});
  const [savingComments, setSavingComments] = useState<Record<string, boolean>>({});
  const [deletingComments, setDeletingComments] = useState<Record<string, boolean>>({});
  const [rerunning, setRerunning] = useState<Record<string, boolean>>({});
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);
  // If this is a group assignment we'll compute the student's group and
  // filter which problems are shown. Cache per-student group lookups.
  // undefined = not yet resolved; null = resolved -> student is not in any group
  const [selectedStudentGroupId, setSelectedStudentGroupId] = useState<string | null | undefined>(
    undefined,
  );
  const studentGroupCache = useRef<Record<string, string | null | undefined>>({});

  // Load all course problems and prefer client-side filtering for the submissions tab.
  // Fall back to `problems` prop if the fetch fails or isn't provided.
  const [allProblems, setAllProblems] = useState<Problem[]>(problems ?? []);
  const [problemsLoading, setProblemsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadAllProblems() {
      if (!courseId) return;
      setProblemsLoading(true);
      try {
        const res = await fetch(`/api/courses/${courseId}/problems`);
        if (!res.ok) throw new Error('Failed to load problems');
        const data = await res.json();
        if (!cancelled) setAllProblems(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to load problems:', err);
        if (!cancelled) setAllProblems(problems ?? []);
      } finally {
        if (!cancelled) setProblemsLoading(false);
      }
    }
    loadAllProblems();
    return () => {
      cancelled = true;
    };
  }, [courseId, problems]);

  // Grade editing state (robust, GradesCard style)
  const [editingGrade, setEditingGrade] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingGrade, setIsSavingGrade] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [userGrade, setUserGrade] = useState<number | null>(null);
  const [isLoadingGrade, setIsLoadingGrade] = useState(false);
  const [problemGrades, setProblemGrades] = useState<Record<string, number | null>>({});
  const [gradeInputs, setGradeInputs] = useState<Record<string, string>>({});
  const [problemGradeErrors, setProblemGradeErrors] = useState<Record<string, string | null>>({});
  const [savingProblemGrades, setSavingProblemGrades] = useState<Record<string, boolean>>({});
  const [loadingProblemGrades, setLoadingProblemGrades] = useState(false);
  const [studentGradeStatuses, setStudentGradeStatuses] = useState<Record<string, boolean>>({});
  const [openDialog, setOpenDialog] = useState<{
    open: boolean;
    submission: Submission | null;
  }>({ open: false, submission: null });

  const updateQuery = useCallback(
    (problemId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('problemId', problemId);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const updateStudentQuery = useCallback(
    (studentId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('studentId', studentId);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  // Build the assignment-specific problem list using the fetched `allProblems` (prefer enriched objects).
  const assignmentProblems = useMemo(() => {
    if (!problems || problems.length === 0) {
      // parent didn't pass assignment problems — fall back to `allProblems`
      return allProblems;
    }
    // Prefer enriched problem objects from `allProblems` when available.
    return problems.map((ap) => allProblems.find((p) => p.id === ap.id) ?? ap);
  }, [problems, allProblems]);

  // Compute which problems should be visible for the selected student when
  // this is a group assignment. Rules:
  // - Problems mapped to the student's group are visible
  // - Problems not mapped to any group (assignment-level) are visible to all
  // - If group mapping isn't available yet, fall back to showing all problems
  const visibleProblems = useMemo(() => {
    // If this is not a group assignment, show all assignment problems
    if (!assignmentIsGroup) return assignmentProblems;

    const gpMap = groupProblemsMap ?? {};
    const allMapped = new Set<string>(Object.values(gpMap).flat());

    // Assignment-level problems = problems not mapped to any group
    const assignmentLevel = assignmentProblems.filter((p) => !allMapped.has(p.id));

    // If mappings not loaded yet -> fall back to showing all assignment problems
    if (!gpMap || Object.keys(gpMap).length === 0) return assignmentProblems;

    // If we don't yet know the student's group (undefined), show assignment-level + all group-mapped (safe fallback)
    if (selectedStudentGroupId === undefined) {
      const byGroup = new Set<string>([
        ...assignmentLevel.map((p) => p.id),
        ...Object.values(gpMap).flat(),
      ]);
      return assignmentProblems.filter((p) => byGroup.has(p.id));
    }

    // If the student is resolved to be NOT in any group (null), show only assignment-level problems
    if (selectedStudentGroupId === null) {
      return assignmentLevel;
    }

    // Visible = assignment-level + problems mapped to the student's group
    const allowed = new Set<string>(assignmentLevel.map((p) => p.id));
    for (const pid of gpMap[selectedStudentGroupId] ?? []) allowed.add(pid);
    return assignmentProblems.filter((p) => allowed.has(p.id));
  }, [assignmentProblems, selectedStudentGroupId, groupProblemsMap, assignmentIsGroup]);

  // Initialize selected problem from the URL, but only from the set of
  // currently visible problems (handles group assignment filtering).
  useEffect(() => {
    if (visibleProblems.length === 0) return;
    const paramProblemId = searchParams.get('problemId');
    const validProblemId = visibleProblems.some((p) => p.id === paramProblemId)
      ? (paramProblemId as string)
      : visibleProblems[0].id;

    setSelectedProblemId(validProblemId);
    if (paramProblemId !== validProblemId) {
      updateQuery(validProblemId);
    }
  }, [visibleProblems, searchParams, updateQuery]);

  const selectedStudent = students[selectedIndex] ?? null;
  const selectedStudentId = selectedStudent?.id ?? null;

  const assignmentTotals = useMemo(() => {
    if (!selectedStudent) return null;

    const totalEarned = assignmentProblems.reduce((sum, problem) => {
      const gradeValue = problemGrades[problem.id];
      const safeGrade =
        typeof gradeValue === 'number' && Number.isFinite(gradeValue) ? Math.max(0, gradeValue) : 0;
      return sum + safeGrade;
    }, 0);

    const hasUnlimited = assignmentProblems.some(
      (problem) => typeof problem.maxPoints === 'number' && problem.maxPoints < 0,
    );

    const totalAvailable = hasUnlimited
      ? Number.POSITIVE_INFINITY
      : assignmentProblems.reduce((sum, problem) => {
          const max =
            typeof problem.maxPoints === 'number' && Number.isFinite(problem.maxPoints)
              ? Math.max(0, problem.maxPoints)
              : 0;
          return sum + max;
        }, 0);

    return { earned: totalEarned, available: totalAvailable };
  }, [assignmentProblems, problemGrades, selectedStudent]);

  // Determine which group the selected student belongs to (for group assignments).
  useEffect(() => {
    let cancelled = false;
    async function resolveStudentGroup() {
      if (!assignmentIsGroup || !selectedStudent) {
        setSelectedStudentGroupId(null);
        return;
      }

      // Use cache if present
      const cached = studentGroupCache.current[selectedStudent.id];
      if (cached !== undefined) {
        setSelectedStudentGroupId(cached);
        return;
      }

      // If no groups available, treat as not in any group
      if (!groups || groups.length === 0) {
        studentGroupCache.current[selectedStudent.id] = null;
        setSelectedStudentGroupId(null);
        return;
      }

      try {
        // Fetch members for all groups in parallel and find which contains the student
        const ops = groups.map((g) =>
          fetch(`/api/courses/${courseId}/groups/${g.id}/members`)
            .then((res) => (res.ok ? res.json() : Promise.resolve({ members: [] })))
            .then((data) => ({ id: g.id, members: data?.members ?? [] }))
            .catch(() => ({ id: g.id, members: [] })),
        );
        const results = await Promise.all(ops);
        if (cancelled) return;
        const found = results.find((r) =>
          r.members.some((m: any) => m.userId === selectedStudent.id),
        );
        const gid = found ? found.id : null;
        studentGroupCache.current[selectedStudent.id] = gid;
        setSelectedStudentGroupId(gid);
      } catch (err) {
        console.error('Failed to resolve student group:', err);
        studentGroupCache.current[selectedStudent.id] = null;
        if (!cancelled) setSelectedStudentGroupId(null);
      }
    }

    resolveStudentGroup();
    return () => {
      cancelled = true;
    };
  }, [assignmentIsGroup, selectedStudent, groups, courseId]);

  const handleSelectProblem = useCallback(
    (problemId: string) => {
      setSelectedProblemId(problemId);
      updateQuery(problemId);
    },
    [updateQuery],
  );

  // Fetch students
  useEffect(() => {
    const fetchStudents = async () => {
      try {
        const res = await fetch(`/api/courses/${courseId}/students`);
        if (!res.ok) throw new Error((await res.json())?.error || 'Failed to load students');
        const data: Person[] = await res.json();
        // Sort students alphabetically by last name, then first name (case-insensitive)
        data.sort((a, b) => {
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
        setStudents(data);
        if (data.length > 0) {
          const paramStudentId = searchParams.get('studentId');
          const initialIndex = paramStudentId ? data.findIndex((s) => s.id === paramStudentId) : -1;
          if (initialIndex !== -1) {
            setSelectedIndex(initialIndex);
          } else {
            setSelectedIndex(0);
            updateStudentQuery(data[0].id);
          }
        }
      } catch (err) {
        console.error('Fetch students error:', err);
        showToast.error('Failed to load students');
        setStudents([]);
      }
    };
    fetchStudents();
  }, [courseId, searchParams, updateStudentQuery]);

  useEffect(() => {
    if (!selectedStudent) return;
    const paramStudentId = searchParams.get('studentId');
    if (paramStudentId !== selectedStudent.id) {
      updateStudentQuery(selectedStudent.id);
    }
  }, [searchParams, selectedStudent, updateStudentQuery]);

  useEffect(() => {
    const fetchGradeSummary = async () => {
      if (students.length === 0) {
        setStudentGradeStatuses({});
        return;
      }
      try {
        const res = await fetch(`/api/courses/${courseId}/${assignmentId}/problem-grades/summary`);
        if (!res.ok) {
          if ([401, 403, 404].includes(res.status)) {
            setStudentGradeStatuses({});
            return;
          }
          throw new Error((await res.json())?.error || 'Failed to load grade summary');
        }
        const data = ((await res.json()) ?? {}) as Record<string, boolean>;
        const normalized: Record<string, boolean> = {};
        students.forEach((student) => {
          normalized[student.id] = Boolean(data?.[student.id]);
        });
        setStudentGradeStatuses(normalized);
      } catch (error) {
        console.error('Failed to load grade summary:', error);
      }
    };

    fetchGradeSummary();
  }, [assignmentId, courseId, students]);

  const fetchSubmissions = useCallback(async () => {
    if (!selectedStudentId) {
      setSubmissions({});
      return;
    }
    try {
      const res = await fetch(
        `/api/courses/${courseId}/${assignmentId}/submissions/${selectedStudentId}`,
      );
      if (!res.ok) {
        if ([401, 403, 404].includes(res.status)) {
          setSubmissions({});
          return;
        }
        throw new Error((await res.json())?.error || 'Failed to load submissions');
      }
      const data = await res.json();
      setSubmissions(data || {});
    } catch (err) {
      console.error('Fetch submissions error:', err);
      showToast.error('Failed to load submissions');
      setSubmissions({});
    }
  }, [courseId, assignmentId, selectedStudentId]);

  // Fetch submissions for selected student
  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  const handleRerunSubmission = useCallback(
    async (submission: Submission) => {
      if (!submission?.id) return;
      setRerunning((prev) => ({ ...prev, [submission.id]: true }));
      try {
        const res = await fetch(`/api/submissions/${submission.id}/rerun`, {
          method: 'POST',
        });
        if (!res.ok) {
          const error = await res.json().catch(() => ({}));
          throw new Error(error?.error || 'Failed to rerun submission');
        }
        showToast.success('Submission re-evaluated');
        await fetchSubmissions();
      } catch (err) {
        console.error('Rerun submission error:', err);
        showToast.error(err instanceof Error ? err.message : 'Failed to rerun submission');
      } finally {
        setRerunning((prev) => ({ ...prev, [submission.id]: false }));
      }
    },
    [fetchSubmissions],
  );

  // Fetch comments only for visible problems (honors group filtering)
  useEffect(() => {
    const loadComments = async () => {
      if (!selectedStudent) {
        setComments({});
        return;
      }
      try {
        const validProblems = visibleProblems.filter((p): p is Problem => Boolean(p?.id));
        const entries = await Promise.all(
          validProblems.map(async (p) => {
            const problemId = p.id;
            try {
              const res = await fetch(
                `/api/comments?assignmentId=${assignmentId}&problemId=${problemId}&studentId=${selectedStudent.id}`,
              );
              if (!res.ok) {
                if ([204, 401, 403, 404].includes(res.status)) {
                  return [problemId, []] as const;
                }
                throw new Error('Failed to load comments');
              }
              const list = res.status === 204 ? [] : await res.json();
              return [problemId, list as DiscussionComment[]] as const;
            } catch (err) {
              console.error(`Fetch comments error for problem ${problemId}:`, err);
              return [problemId, []] as const;
            }
          }),
        );
        setComments(Object.fromEntries(entries));
      } catch (err) {
        console.error('Load comments error:', err);
        showToast.error('Failed to load comments');
        setComments({});
      }
    };
    if (visibleProblems.length > 0) loadComments();
    else setComments({});
  }, [assignmentId, visibleProblems, selectedStudent]);

  useEffect(() => {
    if (!selectedStudent) {
      setProblemGrades({});
      setGradeInputs({});
      setProblemGradeErrors({});
      setLoadingProblemGrades(false);
      return;
    }

    const fetchGrades = async () => {
      setLoadingProblemGrades(true);
      try {
        const res = await fetch(
          `/api/courses/${courseId}/${assignmentId}/problem-grades/${selectedStudent.id}`,
        );
        let data: Record<string, { grade: number | null; feedback: string | null }> = {};
        if (res.status === 204) {
          data = {};
        } else if (!res.ok) {
          if ([401, 403, 404].includes(res.status)) {
            data = {};
          } else {
            throw new Error('Failed to fetch grades');
          }
        } else {
          const raw = await res.text();
          if (raw) {
            try {
              data = JSON.parse(raw) as Record<
                string,
                { grade: number | null; feedback: string | null }
              >;
            } catch (parseError) {
              console.error('Failed to parse grades payload:', parseError);
              data = {};
            }
          } else {
            data = {};
          }
        }

        const normalizedGrades: Record<string, number | null> = {};
        const normalizedInputs: Record<string, string> = {};
        assignmentProblems.forEach((problem) => {
          const entry = data?.[problem.id];
          const value = typeof entry?.grade === 'number' ? entry.grade : null;
          normalizedGrades[problem.id] = value;
          normalizedInputs[problem.id] = value === null || value === undefined ? '' : String(value);
        });

        setProblemGrades(normalizedGrades);
        setGradeInputs(normalizedInputs);
        setProblemGradeErrors({});
        if (selectedStudent) {
          const hasAllGrades =
            assignmentProblems.length === 0
              ? true
              : assignmentProblems.every((problem) => {
                  const value = normalizedGrades[problem.id];
                  return value !== null && value !== undefined;
                });
          setStudentGradeStatuses((prev) => ({
            ...prev,
            [selectedStudent.id]: hasAllGrades,
          }));
        }
      } catch (error) {
        console.error('Failed to load problem grades:', error);
        setProblemGrades({});
        setGradeInputs({});
        showToast.error('Failed to load problem grades');
      } finally {
        setLoadingProblemGrades(false);
      }
    };

    fetchGrades();
  }, [courseId, assignmentId, selectedStudent, assignmentProblems]);

  const saveComment = useCallback(
    async (problemId: string) => {
      const commentText = commentTexts[problemId]?.trim();
      if (!commentText || !selectedStudent) return;

      setSavingComments((prev) => ({ ...prev, [problemId]: true }));
      try {
        const response = await fetch('/api/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: commentText,
            assignmentId,
            problemId,
            studentId: selectedStudent.id,
          }),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error?.error || 'Failed to save comment');
        }
        const newComment = await response.json();
        setComments((prev) => ({
          ...prev,
          [problemId]: [...(prev[problemId] || []), newComment],
        }));
        setCommentTexts((prev) => ({ ...prev, [problemId]: '' }));
        showToast.success('Comment saved successfully');
      } catch (err) {
        console.error('Save comment error:', err);
        showToast.error(err instanceof Error ? err.message : 'Failed to save comment');
      } finally {
        setSavingComments((prev) => ({ ...prev, [problemId]: false }));
      }
    },
    [commentTexts, selectedStudent, assignmentId],
  );

  const deleteComment = useCallback(async (commentId: string, problemId: string) => {
    setDeletingComments((prev) => ({ ...prev, [commentId]: true }));
    try {
      const response = await fetch(`/api/comments?commentId=${commentId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error || 'Failed to delete comment');
      }
      setComments((prev) => ({
        ...prev,
        [problemId]: prev[problemId]?.filter((c) => c.id !== commentId) || [],
      }));
      showToast.success('Comment deleted successfully');
    } catch (err) {
      console.error('Delete comment error:', err);
      showToast.error(err instanceof Error ? err.message : 'Failed to delete comment');
    } finally {
      setDeletingComments((prev) => ({ ...prev, [commentId]: false }));
    }
  }, []);

  const handleGradeInputChange = useCallback((problemId: string, value: string) => {
    setGradeInputs((prev) => ({ ...prev, [problemId]: value }));
    setProblemGradeErrors((prev) => ({ ...prev, [problemId]: null }));
  }, []);

  const saveProblemGrade = useCallback(
    async (problemId: string) => {
      if (!selectedStudent) return;
      if (courseIsArchived) {
        showToast.error('Course is archived; grades cannot be edited.');
        return;
      }

      const problem = assignmentProblems.find((p) => p.id === problemId);
      if (!problem) return;
      const rawMaxPoints = typeof problem.maxPoints === 'number' ? problem.maxPoints : null;
      const hasUpperBound = typeof rawMaxPoints === 'number' && rawMaxPoints >= 0;
      const rawValue = gradeInputs[problemId] ?? '';
      const trimmed = rawValue.trim();
      const numericValue = trimmed === '' ? null : Number(trimmed);

      if (numericValue !== null) {
        if (Number.isNaN(numericValue)) {
          setProblemGradeErrors((prev) => ({ ...prev, [problemId]: 'Grade must be a number' }));
          showToast.error('Grade must be a number');
          return;
        }
        if (numericValue < 0) {
          const message = 'Grade must be at least 0';
          setProblemGradeErrors((prev) => ({ ...prev, [problemId]: message }));
          showToast.error(message);
          return;
        }
        if (hasUpperBound && rawMaxPoints !== null && numericValue > rawMaxPoints) {
          const message = `Grade must be between 0 and ${rawMaxPoints}`;
          setProblemGradeErrors((prev) => ({ ...prev, [problemId]: message }));
          showToast.error(message);
          return;
        }
      }

      setProblemGradeErrors((prev) => ({ ...prev, [problemId]: null }));
      setSavingProblemGrades((prev) => ({ ...prev, [problemId]: true }));

      try {
        const res = await fetch(
          `/api/courses/${courseId}/${assignmentId}/problems/${problemId}/grade/${selectedStudent.id}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grade: numericValue }),
          },
        );
        if (!res.ok) {
          const error = await res.json().catch(() => ({}));
          throw new Error(error?.error || 'Failed to save problem grade');
        }

        setProblemGrades((prev) => {
          const updated = { ...prev, [problemId]: numericValue };
          if (selectedStudent) {
            const hasAllGrades =
              assignmentProblems.length === 0
                ? true
                : assignmentProblems.every((problem) => {
                    const value =
                      problem.id === problemId ? numericValue : (prev[problem.id] ?? null);
                    return value !== null && value !== undefined;
                  });
            setStudentGradeStatuses((prevStatus) => ({
              ...prevStatus,
              [selectedStudent.id]: hasAllGrades,
            }));
          }
          return updated;
        });
        setGradeInputs((prev) => ({
          ...prev,
          [problemId]:
            numericValue === null || numericValue === undefined ? '' : String(numericValue),
        }));
        showToast.success(
          `Grade ${numericValue ?? 'cleared'} saved for ${selectedStudent.firstName} ${selectedStudent.lastName} on ${problem.title}`,
        );
      } catch (error) {
        console.error('Save problem grade error:', error);
        const message = error instanceof Error ? error.message : 'Failed to save problem grade';
        setProblemGradeErrors((prev) => ({ ...prev, [problemId]: message }));
        showToast.error(message);
      } finally {
        setSavingProblemGrades((prev) => ({ ...prev, [problemId]: false }));
      }
    },
    [
      assignmentId,
      courseId,
      courseIsArchived,
      gradeInputs,
      assignmentProblems,
      selectedStudent,
      setProblemGrades,
    ],
  );

  const handleSelectChange = (id: string) => {
    const index = students.findIndex((s) => s.id === id);
    if (index !== -1) setSelectedIndex(index);
  };

  const goPrev = () =>
    setSelectedIndex((prev) => {
      if (students.length === 0) return -1;
      const nextIndex = prev <= 0 ? students.length - 1 : prev - 1;
      return nextIndex;
    });
  const goNext = () =>
    setSelectedIndex((prev) => {
      if (students.length === 0) return -1;
      const nextIndex = prev >= students.length - 1 ? 0 : prev + 1;
      return nextIndex;
    });

  return (
    <div>
      {selectedStudent && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <FileText className="h-6 w-6" /> Submissions
            </CardTitle>

            <div className="mt-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <StudentNavigator
                students={students}
                selectedIndex={selectedIndex}
                onSelectStudent={handleSelectChange}
                onPrev={goPrev}
                onNext={goNext}
                gradeStatuses={studentGradeStatuses}
                assignmentTotals={assignmentTotals ?? undefined}
              />
            </div>
          </CardHeader>

          <CardContent>
            {assignmentProblems.length === 0 ? (
              <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
                No problems have been added to this assignment yet.
              </div>
            ) : (
              (() => {
                const selectedProblem = selectedProblemId
                  ? visibleProblems.find((p) => p.id === selectedProblemId) || null
                  : visibleProblems[0] || null;
                const selectedSubs = selectedProblem
                  ? extractSubs(submissions[selectedProblem.id])
                  : [];
                const selectedComments = selectedProblem ? comments[selectedProblem.id] || [] : [];

                return (
                  <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
                    <ProblemList
                      problems={visibleProblems}
                      submissions={submissions}
                      selectedProblemId={selectedProblem?.id ?? null}
                      onSelect={handleSelectProblem}
                    />

                    <div className="print:col-span-2">
                      <ProblemWorkspace
                        problem={selectedProblem}
                        submissions={selectedSubs}
                        comments={selectedComments}
                        commentText={selectedProblem ? commentTexts[selectedProblem.id] || '' : ''}
                        onCommentTextChange={(text) =>
                          selectedProblem &&
                          setCommentTexts((prev) => ({
                            ...prev,
                            [selectedProblem.id]: text,
                          }))
                        }
                        onSaveComment={() => selectedProblem && saveComment(selectedProblem.id)}
                        onDeleteComment={(commentId) =>
                          selectedProblem && deleteComment(commentId, selectedProblem.id)
                        }
                        isSaving={selectedProblem ? savingComments[selectedProblem.id] : false}
                        deletingComments={deletingComments}
                        onViewSubmission={(submission) => setOpenDialog({ open: true, submission })}
                        onRerunSubmission={handleRerunSubmission}
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
                      />
                    </div>
                  </div>
                );
              })()
            )}
          </CardContent>
        </Card>
      )}

      {openDialog.submission &&
        ['FA', 'PDA'].includes(
          visibleProblems.find((p) => p.id === selectedProblemId)?.type ?? '',
        ) && (
          <JffViewerDialog
            open={openDialog.open}
            onOpenChange={(open) => setOpenDialog({ open, submission: null })}
            src={`/api/uploads/submissions/${encodeURIComponent(
              openDialog.submission.fileName ?? '',
            )}`}
            title={`${openDialog.submission.originalFileName || openDialog.submission.fileName} - Submission`}
            width="70vw"
            height="70vh"
          />
        )}
      {openDialog.submission &&
        (visibleProblems.find((p) => p.id === selectedProblemId)?.type ?? '') === 'RE' && (
          <RegexViewerDialog
            open={openDialog.open}
            onOpenChange={(open) => setOpenDialog({ open, submission: null })}
            src={`/api/uploads/submissions/${encodeURIComponent(
              openDialog.submission.fileName ?? '',
            )}`}
            title={`${openDialog.submission.originalFileName || openDialog.submission.fileName} - Submission`}
          />
        )}
      {openDialog.submission &&
        (visibleProblems.find((p) => p.id === selectedProblemId)?.type ?? '') === 'CFG' && (
          <CfgViewerDialog
            open={openDialog.open}
            onOpenChange={(open) => setOpenDialog({ open, submission: null })}
            src={`/api/uploads/submissions/${encodeURIComponent(
              openDialog.submission.fileName ?? '',
            )}`}
            title={`${openDialog.submission.originalFileName || openDialog.submission.fileName} - Submission`}
          />
        )}
    </div>
  );
}
