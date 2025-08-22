"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  CheckCircle,
  XCircle,
  Package,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input"; // grade box
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
  courseId: string;
  assignmentId: string;
  problems: Problem[];
};

// ---------------- helpers ----------------

const extractSubs = (raw?: SubmissionData): Submission[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && "submissions" in raw)
    return (raw as { submissions: Submission[] }).submissions;
  return [];
};

// ---------------- component ----------------

export default function AssignmentSubmissions({
  courseId,
  assignmentId,
  problems,
}: Props) {
  const [students, setStudents] = useState<Person[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  const [submissions, setSubmissions] = useState<Record<string, SubmissionData>>(
    {}
  );
  const [comments, setComments] = useState<Record<string, DiscussionComment[]>>({});
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});
  const [savingComments, setSavingComments] = useState<
    Record<string, boolean>
  >({});
  const [deletingComments, setDeletingComments] = useState<
    Record<string, boolean>
  >({});
  const [expandedProblems, setExpandedProblems] = useState<
    Record<string, boolean>
  >({});

  const [leftPanelWidth, setLeftPanelWidth] = useState(66.67); // 2/3 as percentage
  const [isDragging, setIsDragging] = useState(false);

  const [gradeDraft, setGradeDraft] = useState<string>("");
  const [gradeSaving, setGradeSaving] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);

  const resetGradeUI = () => {
    setGradeDraft("");
    setGradeError(null);
  };

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
    
    // Constrain between 30% and 80%
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

  useEffect(() => {
    fetch(`/api/courses/${courseId}/students`)
      .then((res) => res.json())
      .then((data: Person[]) => {
        setStudents(data);
        if (data.length > 0) setSelectedIndex(0);
      })
      .catch(() => setStudents([]));
  }, [courseId]);

  useEffect(() => {
    if (!selectedStudent) return;
    fetch(
      `/api/courses/${courseId}/${assignmentId}/submissions/${selectedStudent.id}`
    )
      .then((res) => res.json())
      .then((data) => setSubmissions(data || {}))
      .catch(() => setSubmissions({}));
  }, [courseId, assignmentId, selectedStudent]);

  useEffect(() => {
    const loadComments = async () => {
      if (!selectedStudent) {
        setComments({});
        return;
      }
      const entries = await Promise.all(
        problems.map(async (p) => {
          try {
            const r = await fetch(
              `/api/comments?assignmentId=${assignmentId}&problemId=${p.id}&studentId=${selectedStudent.id}`
            );
            const list = r.ok ? await r.json() : [];
            return [p.id, list as Comment[]] as const;
          } catch {
            return [p.id, []] as const;
          }
        })
      );
      setComments(Object.fromEntries(entries));
    };
    if (problems.length > 0) loadComments();
  }, [assignmentId, problems, selectedStudent]);

  useEffect(() => {
    setGradeDraft("");
    setGradeError(null);
    if (!selectedStudent) return;
    (async () => {
      try {
        const r = await fetch(
          `/api/courses/${courseId}/${assignmentId}/grade/${selectedStudent.id}`
        );
        if (r.ok) {
          const { grade } = await r.json();
          if (typeof grade === "number") {
            setGradeDraft(String(grade));
          }
        }
      } catch {}
    })();
  }, [courseId, assignmentId, selectedStudent]);

  const saveComment = async (problemId: string) => {
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
      if (response.ok) {
        const newComment = await response.json();
        setComments((prev) => ({
          ...prev,
          [problemId]: [...(prev[problemId] || []), newComment],
        }));
        setCommentTexts((prev) => ({ ...prev, [problemId]: "" }));
      }
    } catch {}
    setSavingComments((prev) => ({ ...prev, [problemId]: false }));
  };

  const deleteComment = async (commentId: string, problemId: string) => {
    setDeletingComments((prev) => ({ ...prev, [commentId]: true }));
    try {
      const response = await fetch(`/api/comments?commentId=${commentId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setComments((prev) => ({
          ...prev,
          [problemId]:
            prev[problemId]?.filter((c) => c.id !== commentId) || [],
        }));
      }
    } catch {}
    setDeletingComments((prev) => ({ ...prev, [commentId]: false }));
  };

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
  const goNext = () =>
    setSelectedIndex((prev) => Math.min(students.length - 1, prev + 1));

  // grade
  const onGradeChange = (v: string) => {
    setGradeDraft(v);
    setGradeError(null);
  };
  const validateGrade = (v: string) => {
    if (v.trim() === "") return "Enter a grade.";
    const n = Number(v);
    if (!Number.isFinite(n)) return "Grade must be a number.";
    if (n < 0 || n > 100) return "Grade must be between 0 and 100.";
    return null;
  };
  const saveGrade = async () => {
    if (!selectedStudent) return;
    const err = validateGrade(gradeDraft);
    if (err) {
      setGradeError(err);
      showToast.error(err);
      return;
    }
    setGradeSaving(true);
    try {
      const res = await fetch(
        `/api/courses/${courseId}/${assignmentId}/grade`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: selectedStudent.id,
            grade: Number(gradeDraft),
          }),
        }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const errorMessage = json?.error || "Failed to save grade";
        setGradeError(errorMessage);
        showToast.error(errorMessage);
      } else {
        showToast.success(`Grade ${gradeDraft} saved for ${selectedStudent.firstName} ${selectedStudent.lastName}`);
        setGradeError(null);
      }
    } catch {
      const errorMessage = "Network error while saving grade";
      setGradeError(errorMessage);
      showToast.error(errorMessage);
    } finally {
      setGradeSaving(false);
    }
  };
  const clearGrade = () => {
    setGradeDraft("");
    setGradeError(null);
  };

  return (
    <div>
      {selectedStudent && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Package className="h-6 w-6" /> Submissions
            </CardTitle>

            {/* Top bar: student nav + filters + grade */}
            <div className="mt-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              {/* left: student nav */}
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={goPrev}
                  disabled={selectedIndex <= 0}
                  className="flex items-center gap-x-1"
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <select
                  className="w-[220px] rounded border px-3 py-2"
                  onChange={(e) => handleSelectChange(e.target.value)}
                  value={selectedStudent?.id ?? ""}
                  aria-label="Select student"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.firstName} {s.lastName}
                    </option>
                  ))}
                </select>
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

              {/* center: filters */}
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

              {/* right: grade box */}

                  <div className="flex items-center gap-2 border p-2">
                    <div className="text-sm text-black">Student Grade:</div>
                    <div className="relative">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={100}
                        step="0.5"
                        value={gradeDraft}
                        onChange={(e) => onGradeChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveGrade();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            clearGrade();
                          }
                        }}
                        className={`bg-white h-9 w-[90px] pr-8 ${
                          gradeError ? "border-red-300 focus-visible:ring-red-400" : ""
                        }`}
                        placeholder="0–100"
                        aria-label="Grade (0–100)"
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        /100
                      </span>
                    </div>
                    <Button
                      size="sm"
                      onClick={saveGrade}
                      disabled={
                        gradeSaving || !!gradeError || gradeDraft.trim() === ""
                      }
                      variant="secondary"
                    >
                      {gradeSaving ? "Saving…" : "Save Grade"}
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

                // Border color based on problem type
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

                // filtered submissions per controls
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
                    {/* header */}
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
                      <div className="flex gap-2">
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
                    </div>

                    {/* details */}
                    {isExpanded && (
                      <div className="resize-container flex gap-4">
                        {/* submissions: adjustable width */}
                        <section 
                          className="min-w-0" 
                          style={{ width: `${leftPanelWidth}%` }}
                        >
                          {/* Problem Information Card */}
                          <ProblemDetails problem={problem} submissionCount={subsAll.length} className="mb-4"/>
                          
                          {/* Submissions Table */}
                          <SubmissionsTable submissions={filtered} />
                        </section>

                        {/* Draggable resize handle */}
                        <div
                          className="w-1 bg-gray-300 hover:bg-gray-400 cursor-col-resize transition-colors"
                          onMouseDown={handleMouseDown}
                          title="Drag to resize"
                        />

                        {/* discussion: adjustable width */}
                        <DiscussionPanel
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
