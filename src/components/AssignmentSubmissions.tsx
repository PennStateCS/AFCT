'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  MessageSquare,
  ChevronDown,
  Check,
  X,
  Minus,
  RefreshCw,
  Download,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Input } from './ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import DiscussionPanel, { Comment as DiscussionComment } from './DiscussionPanel';
import JffViewerDialog from './JffViewerDialog';

type Person = Pick<User, 'firstName' | 'lastName' | 'id'>;

type Problem = {
  id: string;
  title: string;
  description?: string;
  type?: string;
  maxStates?: number;
  isDeterministic?: boolean;
  fileName?: string;
  originalFileName?: string;
};

type SubmissionData = Submission[] | { submissions: Submission[] };

type Props = {
  courseIsArchived: boolean;
  courseId: string;
  assignmentId: string;
  maxAssignmentGrade: number;
  problems: Problem[];
};

// Helpers
const extractSubs = (raw?: SubmissionData): Submission[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && 'submissions' in raw)
    return (raw as { submissions: Submission[] }).submissions;
  return [];
};

const getTypeBadge = (type?: string) => {
  if (!type) return null;
  const map: Record<string, { label: string; className: string }> = {
    PDA: {
      label: 'Pushdown Automaton',
      className: 'bg-purple-100 text-purple-800 border-purple-200',
    },
    RE: { label: 'Regular Expression', className: 'bg-blue-100 text-blue-800 border-blue-200' },
    CFG: {
      label: 'Context-Free Grammar',
      className: 'bg-green-100 text-green-800 border-green-200',
    },
    FA: { label: 'Finite Automaton', className: 'bg-orange-100 text-orange-800 border-orange-200' },
  };
  return map[type] || { label: type, className: 'bg-gray-100 text-gray-800 border-gray-200' };
};

function ProblemList({
  problems,
  submissions,
  selectedProblemId,
  onSelect,
}: {
  problems: Problem[];
  submissions: Record<string, SubmissionData>;
  selectedProblemId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="text-base">Problems</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[520px]">
          <ul className="divide-border divide-y">
            {problems.map((p) => {
              const subs = extractSubs(submissions[p.id]);
              const count = subs.length;
              const hasCorrect = subs.some((s) => s.correct === true);
              const active = selectedProblemId === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(p.id)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                      active ? 'bg-secondary text-secondary-foreground' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className="truncate">{p.title}</span>
                    <Badge variant="outline" className="shrink-0 bg-white text-slate-900">
                      <span className="flex items-center gap-1">
                        {hasCorrect ? (
                          <Check className="h-3 w-3 text-green-600" />
                        ) : (
                          <X className="h-3 w-3 text-red-600" />
                        )}
                        {count}
                      </span>
                    </Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

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
            const rawJson = s.evaluationRaw
              ? typeof s.evaluationRaw === 'string'
                ? s.evaluationRaw
                : JSON.stringify(s.evaluationRaw, null, 2)
              : null;

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
                    {s.fileName ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="secondary">
                            <ChevronDown className="mr-1 h-4 w-4" /> Manage
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => onView(s)}
                            className="flex items-center gap-2"
                          >
                            <Eye className="h-4 w-4" /> View Solution
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onRerun(s)}
                            disabled={rerunning[s.id]}
                            className="flex items-center gap-2"
                          >
                            <RefreshCw className="h-4 w-4" />
                            {rerunning[s.id] ? 'Rerunning…' : 'Rerun Evaluator'}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              if (!s.fileName) return;
                              const url = `/api/uploads/submissions/${encodeURIComponent(s.fileName)}`;
                              window.open(url, '_blank', 'noopener,noreferrer');
                            }}
                            className="flex items-center gap-2"
                          >
                            <Download className="h-4 w-4" /> Download Submission
                          </DropdownMenuItem>
                          <Dialog>
                            <DialogTrigger asChild>
                              <DropdownMenuItem
                                disabled={!rawJson}
                                className="flex items-center gap-2"
                                onSelect={(event) => event.preventDefault()}
                              >
                                <FileText className="h-4 w-4" /> View Raw JSON
                              </DropdownMenuItem>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                              <DialogHeader>
                                <DialogTitle>Raw evaluation JSON</DialogTitle>
                              </DialogHeader>
                              <pre className="max-h-[60vh] overflow-auto rounded-md bg-white p-3 text-xs leading-relaxed text-slate-900">
                                {rawJson ?? 'No raw JSON available.'}
                              </pre>
                            </DialogContent>
                          </Dialog>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="text-muted-foreground text-sm">No file</span>
                    )}
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

  return (
    <Card className="print:border-0 print:shadow-none">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="text-lg">{problem.title}</CardTitle>
          <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
            {(() => {
              const badge = getTypeBadge(problem.type);
              return badge ? (
                <Badge variant="outline" className={badge.className}>
                  {badge.label}
                </Badge>
              ) : null;
            })()}
            {typeof problem.maxStates === 'number' ? (
              <span>Max States: {problem.maxStates === -1 ? 'Unlimited' : problem.maxStates}</span>
            ) : null}
            {typeof problem.isDeterministic === 'boolean' ? (
              <span>{problem.isDeterministic ? 'Deterministic' : 'Nondeterministic'}</span>
            ) : null}
          </div>
        </div>
        {problem.description ? (
          <div className="text-muted-foreground mt-2 text-sm">{problem.description}</div>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="grid items-stretch gap-4 lg:grid-cols-[60%_40%]">
          <section className="flex h-full flex-col overflow-hidden rounded-md border">
            <div className="flex items-center gap-2 border-b bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
              <FileText className="h-4 w-4" /> Submissions
            </div>
            <div className="flex-1 p-3">
              <SubmissionTable
                submissions={submissions}
                onView={onViewSubmission}
                onRerun={onRerunSubmission}
                rerunning={rerunning}
                className="h-full"
              />
            </div>
          </section>
          <section className="flex h-full flex-col overflow-hidden rounded-md border">
            <div className="flex items-center gap-2 border-b bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
              <MessageSquare className="h-4 w-4" /> Discussion
            </div>
            <div className="flex-1 p-3">
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
            </div>
          </section>
        </div>
      </CardContent>
    </Card>
  );
}

function ProblemDiscussionPanel({
  courseIsArchived,
  comments,
  commentText,
  onCommentTextChange,
  onSaveComment,
  onDeleteComment,
  isSaving,
  deletingComments,
}: {
  courseIsArchived: boolean;
  comments: DiscussionComment[];
  commentText: string;
  onCommentTextChange: (text: string) => void;
  onSaveComment: () => void;
  onDeleteComment: (id: string) => void;
  isSaving?: boolean;
  deletingComments?: Record<string, boolean>;
}) {
  return (
    <DiscussionPanel
      courseIsArchived={courseIsArchived}
      comments={comments}
      commentText={commentText}
      onCommentTextChange={onCommentTextChange}
      onSaveComment={onSaveComment}
      onDeleteComment={onDeleteComment}
      isSaving={isSaving}
      deletingComments={deletingComments}
      placeholder="Add a comment about this problem…"
      className="min-w-0 flex-1"
      frameless
    />
  );
}

export default function AssignmentSubmissions({
  courseIsArchived,
  courseId,
  assignmentId,
  maxAssignmentGrade,
  problems,
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
  const [gradeStatus, setGradeStatus] = useState<Record<string, boolean>>({});
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);
  // Grade editing state (robust, GradesCard style)
  const [editingGrade, setEditingGrade] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingGrade, setIsSavingGrade] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [userGrade, setUserGrade] = useState<number | null>(null);
  const [isLoadingGrade, setIsLoadingGrade] = useState(false);
  const [openDialog, setOpenDialog] = useState<{
    open: boolean;
    submission: Submission | null;
  }>({ open: false, submission: null });

  // Student search/filter
  const [studentFilter, setStudentFilter] = useState<string>('');
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filteredStudents = useMemo(() => {
    const f = studentFilter.trim().toLowerCase();
    if (!f) return students;
    return students.filter((s) => {
      const full = `${s.firstName ?? ''} ${s.lastName ?? ''}`.toLowerCase();
      return (
        full.includes(f) ||
        (s.firstName ?? '').toLowerCase().includes(f) ||
        (s.lastName ?? '').toLowerCase().includes(f)
      );
    });
  }, [students, studentFilter]);

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

  useEffect(() => {
    if (problems.length === 0) return;
    const paramProblemId = searchParams.get('problemId');
    const validProblemId = problems.some((p) => p.id === paramProblemId)
      ? (paramProblemId as string)
      : problems[0].id;

    setSelectedProblemId(validProblemId);
    if (paramProblemId !== validProblemId) {
      updateQuery(validProblemId);
    }
  }, [problems, searchParams, updateQuery]);

  useEffect(() => {
    if (menuOpen) {
      // Focus the search input when the menu opens
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [menuOpen]);

  const selectedStudent = students[selectedIndex] ?? null;

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

  const fetchSubmissions = useCallback(async () => {
    if (!selectedStudent) {
      setSubmissions({});
      return;
    }
    try {
      const res = await fetch(
        `/api/courses/${courseId}/${assignmentId}/submissions/${selectedStudent.id}`,
      );
      if (!res.ok) {
        if (res.status === 404) {
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
  }, [courseId, assignmentId, selectedStudent]);

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

  // Fetch comments for all problems
  useEffect(() => {
    const loadComments = async () => {
      if (!selectedStudent) {
        setComments({});
        return;
      }
      try {
        const validProblems = problems.filter((p): p is Problem => Boolean(p?.id));
        const entries = await Promise.all(
          validProblems.map(async (p) => {
            try {
              const res = await fetch(
                `/api/comments?assignmentId=${assignmentId}&problemId=${p.id}&studentId=${selectedStudent.id}`,
              );
              if (!res.ok) throw new Error('Failed to load comments');
              const list = await res.json();
              return [p.id, list as DiscussionComment[]] as const;
            } catch (err) {
              console.error(`Fetch comments error for problem ${p.id}:`, err);
              return [p.id, []] as const;
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
    if (problems.length > 0) loadComments();
  }, [assignmentId, problems, selectedStudent]);

  // Fetch grade for selected student
  useEffect(() => {
    if (!selectedStudent) {
      setUserGrade(null);
      setEditingGrade('');
      setIsEditing(false);
      setGradeError(null);
      setIsLoadingGrade(false);
      return;
    }
    setIsLoadingGrade(true);
    setUserGrade(null);
    setEditingGrade('');
    setIsEditing(false);
    setGradeError(null);
    const fetchGrade = async () => {
      try {
        const res = await fetch(
          `/api/courses/${courseId}/${assignmentId}/grade/${selectedStudent.id}`,
        );
        if (res.ok) {
          const { grade } = await res.json();
          setUserGrade(typeof grade === 'number' ? grade : null);
          setEditingGrade(typeof grade === 'number' ? String(grade) : '');
          setIsEditing(false);
          setGradeError(null);
        } else {
          setUserGrade(null);
          setEditingGrade('');
          setIsEditing(false);
          setGradeError(null);
        }
      } catch (err) {
        setUserGrade(null);
        setEditingGrade('');
        setIsEditing(false);
        setGradeError(null);
        console.error('Fetch grade error:', err);
      } finally {
        setIsLoadingGrade(false);
      }
    };
    fetchGrade();
  }, [courseId, assignmentId, selectedStudent]);

  // Fetch grade status for all students (used for dropdown indicators)
  useEffect(() => {
    if (!courseId || !assignmentId) return;
    const fetchGradeStatus = async () => {
      try {
        const res = await fetch(`/api/courses/${courseId}/grades`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          grades?: Record<string, Record<string, number | null>>;
        };
        const grades = data?.grades ?? {};
        const status: Record<string, boolean> = {};
        Object.keys(grades).forEach((studentId) => {
          status[studentId] = grades[studentId]?.[assignmentId] != null;
        });
        setGradeStatus(status);
      } catch (err) {
        console.warn('Fetch grade status error:', err);
      }
    };
    fetchGradeStatus();
  }, [courseId, assignmentId]);

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

  // Save grade (robust, GradesCard style)
  const saveGrade = useCallback(async () => {
    if (!selectedStudent) return;
    // Only disable Save button while saving
    if (isSavingGrade) return;
    // Only validate if value changed
    const trimmed = editingGrade.trim();
    const numericValue = trimmed === '' ? null : Number(trimmed);
    if (
      numericValue !== null &&
      (isNaN(numericValue) || numericValue < 0 || numericValue > maxAssignmentGrade)
    ) {
      setGradeError(`Grade must be a number between 0 and ${maxAssignmentGrade}`);
      showToast.error(`Grade must be a number between 0 and ${maxAssignmentGrade}`);
      return;
    }
    // If value is unchanged, do nothing
    if (
      (userGrade === null && (numericValue === null || numericValue === undefined)) ||
      userGrade === numericValue
    ) {
      setGradeError(null);
      return;
    }
    setIsSavingGrade(true);
    setGradeError(null);
    try {
      const res = await fetch(
        `/api/courses/${courseId}/${assignmentId}/grade/${selectedStudent.id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grade: numericValue }),
        },
      );
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.error || 'Failed to save grade');
      }
      // Do not re-fetch grade, just update state
      setUserGrade(numericValue);
      setEditingGrade(
        numericValue !== null && numericValue !== undefined ? String(numericValue) : '',
      );
      setGradeStatus((prev) => ({
        ...prev,
        [selectedStudent.id]: numericValue !== null && numericValue !== undefined,
      }));
      setGradeError(null);
      showToast.success(
        `Grade ${numericValue ?? 'cleared'} saved for ${selectedStudent.firstName} ${selectedStudent.lastName}`,
      );
    } catch (err) {
      console.error('Save grade error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to save grade';
      setGradeError(errorMessage);
      showToast.error(errorMessage);
    } finally {
      setIsSavingGrade(false);
    }
  }, [
    selectedStudent,
    courseId,
    assignmentId,
    maxAssignmentGrade,
    editingGrade,
    userGrade,
    isSavingGrade,
  ]);

  const handleSelectChange = (id: string) => {
    const index = students.findIndex((s) => s.id === id);
    if (index !== -1) setSelectedIndex(index);
  };

  const goPrev = () => setSelectedIndex((prev) => Math.max(0, prev - 1));
  const goNext = () => setSelectedIndex((prev) => Math.min(students.length - 1, prev + 1));

  return (
    <div>
      {selectedStudent && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <FileText className="h-6 w-6" /> Submissions
            </CardTitle>

            <div className="mt-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              {/* Student nav */}
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={goPrev}
                  disabled={selectedIndex <= 0}
                  className="flex items-center gap-x-1"
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="bg-card text-foreground border-border hover:bg-input focus:ring-primary-300 flex w-[320px] items-center justify-between gap-2 border focus:ring-2 focus:ring-offset-1"
                    >
                      <span className="flex items-center gap-2 truncate">
                        {selectedStudent ? (
                          <>
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${
                                gradeStatus[selectedStudent.id] ? 'bg-green-500' : 'bg-red-500'
                              }`}
                              aria-hidden="true"
                            />
                            <span className="truncate">
                              {selectedStudent.firstName} {selectedStudent.lastName}
                            </span>
                          </>
                        ) : (
                          'Select student'
                        )}
                      </span>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="bg-card text-foreground border-border w-[320px] rounded-md border p-2 shadow-lg">
                    <Input
                      ref={inputRef}
                      placeholder="Search students..."
                      value={studentFilter}
                      onChange={(e) => setStudentFilter(e.target.value)}
                      className="bg-card border-input mb-2"
                      aria-label="Search students by name"
                      onKeyDown={(e) => {
                        // Prevent any keyboard event from bubbling up to the DropdownMenu
                        e.stopPropagation();
                        // Enter selects the first filtered student (if any)
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (filteredStudents.length > 0) {
                            const pick = filteredStudents[0];
                            handleSelectChange(pick.id);
                            setStudentFilter('');
                            setMenuOpen(false);
                          }
                          return;
                        }
                        // Allow Escape to clear the filter
                        if (e.key === 'Escape') {
                          setStudentFilter('');
                        }
                      }}
                    />
                    <div className="max-h-64 overflow-auto">
                      {filteredStudents.length === 0 ? (
                        <div className="text-muted-foreground p-2 text-sm">No students found</div>
                      ) : (
                        filteredStudents.map((s) => (
                          <DropdownMenuItem
                            key={s.id}
                            className="hover:bg-input"
                            onClick={() => {
                              handleSelectChange(s.id);
                              setStudentFilter('');
                              setMenuOpen(false);
                            }}
                          >
                            <span className="flex items-center gap-2 truncate">
                              <span
                                className={`h-2.5 w-2.5 rounded-full ${
                                  gradeStatus[s.id] ? 'bg-green-500' : 'bg-red-500'
                                }`}
                                aria-hidden="true"
                              />
                              {s.firstName} {s.lastName}
                            </span>
                          </DropdownMenuItem>
                        ))
                      )}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="secondary"
                  onClick={goNext}
                  disabled={selectedIndex >= students.length - 1}
                  className="flex items-center gap-x-1"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
                <span className="text-muted-foreground ml-2 text-sm">
                  Student {selectedIndex + 1} of {students.length}
                </span>
              </div>

              {/* Grade box: always-visible input, robust logic */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={maxAssignmentGrade}
                    step="1.0"
                    value={editingGrade === '' ? '' : editingGrade}
                    onChange={(e) => {
                      setEditingGrade(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        saveGrade();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setEditingGrade(
                          userGrade !== null && userGrade !== undefined ? String(userGrade) : '',
                        );
                      }
                    }}
                    className="bg-card border-input h-9 w-[90px] pr-8"
                    placeholder={
                      isLoadingGrade
                        ? '-'
                        : userGrade === null || userGrade === undefined
                          ? '-'
                          : String(userGrade)
                    }
                    aria-label={`Grade (0-${maxAssignmentGrade})`}
                    disabled={isLoadingGrade}
                  />
                  <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs">
                    /{maxAssignmentGrade}
                  </span>
                </div>
                <Button
                  size="sm"
                  onClick={saveGrade}
                  disabled={
                    isSavingGrade ||
                    (() => {
                      const trimmed = editingGrade.trim();
                      const numericValue = trimmed === '' ? null : Number(trimmed);
                      return (
                        (userGrade === null &&
                          (numericValue === null || numericValue === undefined)) ||
                        userGrade === numericValue
                      );
                    })()
                  }
                  variant="secondary"
                  className="h-9"
                >
                  {isSavingGrade ? 'Saving…' : 'Save Grade'}
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {problems.length === 0 ? (
              <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
                No problems have been added to this assignment yet.
              </div>
            ) : (
              (() => {
                const selectedProblem = selectedProblemId
                  ? problems.find((p) => p.id === selectedProblemId) || null
                  : problems[0] || null;
                const selectedSubs = selectedProblem
                  ? extractSubs(submissions[selectedProblem.id])
                  : [];
                const selectedComments = selectedProblem ? comments[selectedProblem.id] || [] : [];

                return (
                  <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
                    <ProblemList
                      problems={problems}
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
                      />
                    </div>
                  </div>
                );
              })()
            )}
          </CardContent>
        </Card>
      )}

      {openDialog.submission && (
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
    </div>
  );
}
