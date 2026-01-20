"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  CheckCircle,
  XCircle,
  Package,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Submission, User } from "@prisma/client";
import { showToast } from "@/lib/toast";
import DiscussionPanel, { Comment as DiscussionComment } from "./DiscussionPanel";
import ProblemDetails from "./ProblemDetails";
import SubmissionsTable from "./SubmissionsTable";

type Person = Pick<User, "firstName" | "lastName" | "id">;

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
  if (raw && typeof raw === "object" && "submissions" in raw)
    return (raw as { submissions: Submission[] }).submissions;
  return [];
};

export default function AssignmentSubmissions({
  courseIsArchived,
  courseId,
  assignmentId,
  maxAssignmentGrade,
  problems,
}: Props) {
  const [students, setStudents] = useState<Person[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [submissions, setSubmissions] = useState<Record<string, SubmissionData>>({});
  const [comments, setComments] = useState<Record<string, DiscussionComment[]>>({});
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});
  const [savingComments, setSavingComments] = useState<Record<string, boolean>>({});
  const [deletingComments, setDeletingComments] = useState<Record<string, boolean>>({});
  const [expandedProblems, setExpandedProblems] = useState<Record<string, boolean>>({});
  const [leftPanelWidth, setLeftPanelWidth] = useState(66.67);
  const [isDragging, setIsDragging] = useState(false);
  // Grade editing state (robust, GradesCard style)
  const [editingGrade, setEditingGrade] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingGrade, setIsSavingGrade] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [userGrade, setUserGrade] = useState<number | null>(null);
  const [isLoadingGrade, setIsLoadingGrade] = useState(false);

  // Student search/filter
  const [studentFilter, setStudentFilter] = useState<string>('');
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filteredStudents = useMemo(() => {
    const f = studentFilter.trim().toLowerCase();
    if (!f) return students;
    return students.filter((s) => {
      const full = `${s.firstName ?? ''} ${s.lastName ?? ''}`.toLowerCase();
      return full.includes(f) || (s.firstName ?? '').toLowerCase().includes(f) || (s.lastName ?? '').toLowerCase().includes(f);
    });
  }, [students, studentFilter]);

  useEffect(() => {
    if (menuOpen) {
      // Focus the search input when the menu opens
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [menuOpen]);

  const selectedStudent = students[selectedIndex] ?? null;

  // Handle draggable resize
  const handleMouseDown = () => {
    setIsDragging(true);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const container = document.querySelector('.resize-container');
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const newWidth = ((e.clientX - rect.left) / rect.width) * 100;
    
    if (newWidth >= 30 && newWidth <= 80) {
      setLeftPanelWidth(newWidth);
    }
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

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
        if (data.length > 0) setSelectedIndex(0);
      } catch (err) {
        console.error('Fetch students error:', err);
        showToast.error('Failed to load students');
        setStudents([]);
      }
    };
    fetchStudents();
  }, [courseId]);

  // Fetch submissions for selected student
  useEffect(() => {
    const fetchSubmissions = async () => {
      if (!selectedStudent) {
        setSubmissions({});
        return;
      }
      try {
        const res = await fetch(
          `/api/courses/${courseId}/${assignmentId}/submissions/${selectedStudent.id}`
        );
        if (!res.ok) throw new Error((await res.json())?.error || 'Failed to load submissions');
        const data = await res.json();
        setSubmissions(data || {});
      } catch (err) {
        console.error('Fetch submissions error:', err);
        showToast.error('Failed to load submissions');
        setSubmissions({});
      }
    };
    fetchSubmissions();
  }, [courseId, assignmentId, selectedStudent]);

  // Fetch comments for all problems
  useEffect(() => {
    const loadComments = async () => {
      if (!selectedStudent) {
        setComments({});
        return;
      }
      try {
        const entries = await Promise.all(
          problems.map(async (p) => {
            try {
              const res = await fetch(
                `/api/comments?assignmentId=${assignmentId}&problemId=${p.id}&studentId=${selectedStudent.id}`
              );
              if (!res.ok) throw new Error('Failed to load comments');
              const list = await res.json();
              return [p.id, list as DiscussionComment[]] as const;
            } catch (err) {
              console.error(`Fetch comments error for problem ${p.id}:`, err);
              return [p.id, []] as const;
            }
          })
        );
        setComments(Object.fromEntries(entries));
      } catch (err) {
        console.error('Load comments error:', err);
        showToast.error('Failed to load comments');
      }
    };
    if (problems.length > 0) loadComments();
  }, [assignmentId, problems, selectedStudent]);

  // Fetch grade for selected student
  useEffect(() => {
    if (!selectedStudent) {
      setUserGrade(null);
      setEditingGrade("");
      setIsEditing(false);
      setGradeError(null);
      setIsLoadingGrade(false);
      return;
    }
    setIsLoadingGrade(true);
    setUserGrade(null);
    setEditingGrade("");
    setIsEditing(false);
    setGradeError(null);
    const fetchGrade = async () => {
      try {
        const res = await fetch(
          `/api/courses/${courseId}/${assignmentId}/grade/${selectedStudent.id}`
        );
        if (res.ok) {
          const { grade } = await res.json();
          setUserGrade(typeof grade === "number" ? grade : null);
          setEditingGrade(typeof grade === "number" ? String(grade) : "");
          setIsEditing(false);
          setGradeError(null);
        } else {
          setUserGrade(null);
          setEditingGrade("");
          setIsEditing(false);
          setGradeError(null);
        }
      } catch (err) {
        setUserGrade(null);
        setEditingGrade("");
        setIsEditing(false);
        setGradeError(null);
        console.error('Fetch grade error:', err);
      } finally {
        setIsLoadingGrade(false);
      }
    };
    fetchGrade();
  }, [courseId, assignmentId, selectedStudent]);

  const saveComment = useCallback(async (problemId: string) => {
    const commentText = commentTexts[problemId]?.trim();
    if (!commentText || !selectedStudent) return;
    
    setSavingComments((prev) => ({ ...prev, [problemId]: true }));
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      setCommentTexts((prev) => ({ ...prev, [problemId]: "" }));
      showToast.success('Comment saved successfully');
    } catch (err) {
      console.error('Save comment error:', err);
      showToast.error(err instanceof Error ? err.message : 'Failed to save comment');
    } finally {
      setSavingComments((prev) => ({ ...prev, [problemId]: false }));
    }
  }, [commentTexts, selectedStudent, assignmentId]);

  const deleteComment = useCallback(async (commentId: string, problemId: string) => {
    setDeletingComments((prev) => ({ ...prev, [commentId]: true }));
    try {
      const response = await fetch(`/api/comments?commentId=${commentId}`, {
        method: "DELETE",
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
    if (numericValue !== null && (isNaN(numericValue) || numericValue < 0 || numericValue > maxAssignmentGrade)) {
      setGradeError(`Grade must be a number between 0 and ${maxAssignmentGrade}`);
      showToast.error(`Grade must be a number between 0 and ${maxAssignmentGrade}`);
      return;
    }
    // If value is unchanged, do nothing
    if ((userGrade === null && (numericValue === null || numericValue === undefined)) || userGrade === numericValue) {
      setGradeError(null);
      return;
    }
    setIsSavingGrade(true);
    setGradeError(null);
    try {
      const res = await fetch(
        `/api/courses/${courseId}/${assignmentId}/grade/${selectedStudent.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grade: numericValue }),
        }
      );
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.error || 'Failed to save grade');
      }
      // Do not re-fetch grade, just update state
      setUserGrade(numericValue);
      setEditingGrade(numericValue !== null && numericValue !== undefined ? String(numericValue) : "");
      setGradeError(null);
      showToast.success(
        `Grade ${numericValue ?? 'cleared'} saved for ${selectedStudent.firstName} ${selectedStudent.lastName}`
      );
    } catch (err) {
      console.error('Save grade error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to save grade';
      setGradeError(errorMessage);
      showToast.error(errorMessage);
    } finally {
      setIsSavingGrade(false);
    }
  }, [selectedStudent, courseId, assignmentId, maxAssignmentGrade, editingGrade, userGrade, isSavingGrade]);

  const toggleProblemExpansion = (problemId: string) =>
    setExpandedProblems((prev) => ({ ...prev, [problemId]: !prev[problemId] }));

  const toggleAllProblems = () => {
    const allExpanded = problems.every((p) => expandedProblems[p.id]);
    const next: Record<string, boolean> = {};
    problems.forEach((p) => (next[p.id] = !allExpanded));
    setExpandedProblems(next);
  };

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
              <Package className="h-6 w-6" /> Submissions
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
                    <Button variant="outline" className="flex items-center gap-2 w-[320px] justify-between bg-white text-foreground border border-gray-200 hover:bg-slate-50 focus:ring-2 focus:ring-offset-1 focus:ring-primary-300">
                      <span className="truncate">{selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : 'Select student'}</span>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[320px] p-2 bg-white text-foreground border border-gray-200 shadow-lg rounded-md">
                    <Input
                      ref={inputRef}
                      placeholder="Search students..."
                      value={studentFilter}
                      onChange={(e) => setStudentFilter(e.target.value)}
                      className="mb-2 bg-gray-50 border border-gray-200"
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
                        <div className="text-sm text-muted-foreground p-2">No students found</div>
                      ) : (
                        filteredStudents.map((s) => (
                          <DropdownMenuItem
                            key={s.id}
                            className="hover:bg-slate-100"
                            onClick={() => {
                              handleSelectChange(s.id);
                              setStudentFilter('');
                              setMenuOpen(false);
                            }}
                          >
                            <span className="truncate">{s.firstName} {s.lastName}</span>
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
                <span className="ml-2 text-sm text-muted-foreground">
                  {selectedIndex + 1} of {students.length}
                </span>
              </div>

              {/* Filters */}
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleAllProblems}
                  className="flex items-center gap-x-1"
                >
                  {problems.every((p) => expandedProblems[p.id]) ? (
                    <>
                      <EyeOff className="h-4 w-4" /> Hide All
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4" /> Show All
                    </>
                  )}
                </Button>
              </div>

              {/* Grade box: always-visible input, robust logic */}
              <div className="flex items-center gap-2 border p-2">
                <div className="text-sm text-black">Student Grade:</div>
                <div className="relative">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={maxAssignmentGrade}
                    step="1.0"
                    value={editingGrade === "" ? "" : editingGrade}
                    onChange={e => {
                      setEditingGrade(e.target.value);
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveGrade();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setEditingGrade(userGrade !== null && userGrade !== undefined ? String(userGrade) : "");
                      }
                    }}
                    className="bg-white h-9 w-[90px] pr-8"
                    placeholder={isLoadingGrade ? '-' : (userGrade === null || userGrade === undefined ? '-' : String(userGrade))}
                    aria-label={`Grade (0-${maxAssignmentGrade})`}
                    disabled={isLoadingGrade}
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
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
                        (userGrade === null && (numericValue === null || numericValue === undefined)) ||
                        userGrade === numericValue
                      );
                    })()
                  }
                  variant="secondary"
                >
                  {isSavingGrade ? "Saving…" : "Save Grade"}
                </Button>

              </div>
            </div>
          </CardHeader>

          <CardContent>
            <div className="space-y-4">
              {problems.map((problem, idx) => {
                const subsAll = extractSubs(submissions[problem.id]);
                const isExpanded = expandedProblems[problem.id] || false;
                const hasAny = subsAll.length > 0;
                const anyCorrect = subsAll.some((s) => s.correct === true);

                const getBorderClass = (type: string | null) => {
                  const borderMap: Record<string, string> = {
                    PDA: "border-l-purple-500",
                    RE: "border-l-blue-500", 
                    CFG: "border-l-green-500",
                    FA: "border-l-orange-500",
                  };
                  return borderMap[type || ""] || "border-l-gray-500";
                };
                const typeBorderClass = getBorderClass(problem.type ?? null);

                const filtered = [...subsAll].sort(
                  (a, b) =>
                    new Date(b.submittedAt).getTime() -
                    new Date(a.submittedAt).getTime()
                );

                return (
                  <div
                    key={problem.id}
                    className={`rounded-lg border border-l-4 p-4 ${typeBorderClass}`}
                  >
                    <div className="mb-4 flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="flex items-center gap-2 text-lg font-semibold">
                          Problem {idx + 1}: {problem.title}
                          {hasAny ? (
                            anyCorrect ? (
                              <Badge className="flex items-center gap-1 bg-green-100 text-green-800">
                                <CheckCircle className="h-3 w-3" /> Correct
                              </Badge>
                            ) : (
                              <Badge className="flex items-center gap-1 bg-red-100 text-red-800">
                                <XCircle className="h-3 w-3" /> Incorrect
                              </Badge>
                            )
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-gray-300 text-gray-600"
                            >
                              No attempts
                            </Badge>
                          )}
                        </h3>
                        {problem.description && (
                          <p className="mt-1 text-muted-foreground">
                            {problem.description}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleProblemExpansion(problem.id)}
                      >
                        {isExpanded ? (
                          <>
                            <EyeOff className="mr-2 h-4 w-4" /> Hide Details
                          </>
                        ) : (
                          <>
                            <Eye className="mr-2 h-4 w-4" /> Show Details
                          </>
                        )}
                      </Button>
                    </div>

                    {isExpanded && (
                      <div className="resize-container flex gap-4">
                        <section 
                          className="min-w-0" 
                          style={{ width: `${leftPanelWidth}%` }}
                        >
                          <ProblemDetails problem={problem} submissionCount={subsAll.length} className="mb-4"/>
                          <SubmissionsTable submissions={filtered} />
                        </section>

                        <div
                          className="w-1 bg-gray-300 hover:bg-gray-400 cursor-col-resize transition-colors"
                          onMouseDown={handleMouseDown}
                          title="Drag to resize"
                        />

                        <DiscussionPanel
                          courseIsArchived={courseIsArchived}
                          comments={comments[problem.id] || []}
                          commentText={commentTexts[problem.id] || ""}
                          onCommentTextChange={(text) =>
                            setCommentTexts((prev) => ({
                              ...prev,
                              [problem.id]: text,
                            }))
                          }
                          onSaveComment={() => saveComment(problem.id)}
                          onDeleteComment={(commentId) =>
                            deleteComment(commentId, problem.id)
                          }
                          isSaving={savingComments[problem.id]}
                          deletingComments={deletingComments}
                          placeholder="Add a comment about this problem…"
                          className="flex-1 min-w-0 ml-1"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}