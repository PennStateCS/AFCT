"use client";

import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Download,
  CheckCircle,
  XCircle,
  Package,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input"; // grade box
import { Switch } from "./ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Submission, User } from "@prisma/client";
import DiscussionPanel, { Comment as DiscussionComment } from "./DiscussionPanel";

type Person = Pick<User, "firstName" | "lastName" | "id">;

type Problem = {
  id: string;
  title: string;
  description?: string;
  type?: string;
  maxStates?: number;
  isDeterministic?: boolean;
};

type SubmissionData = Submission[] | { submissions: Submission[] };

type Props = {
  courseId: string;
  assignmentId: string;
  problems: Problem[];
};

// ---------------- helpers ----------------

const getProblemTypeBadgeProps = (type: string | null) => {
  if (!type) return null;
  const badgeMap: Record<
    string,
    { label: string; className: string; borderColor: string }
  > = {
    PDA: {
      label: "Pushdown Automaton",
      className: "bg-purple-100 text-purple-800 border-purple-200",
      borderColor: "border-l-purple-500",
    },
    RE: {
      label: "Regular Expression",
      className: "bg-blue-100 text-blue-800 border-blue-200",
      borderColor: "border-l-blue-500",
    },
    CFG: {
      label: "Context-Free Grammar",
      className: "bg-green-100 text-green-800 border-green-200",
      borderColor: "border-l-green-500",
    },
    FA: {
      label: "Finite Automaton",
      className: "bg-orange-100 text-orange-800 border-orange-200",
      borderColor: "border-l-orange-500",
    },
  };
  return (
    badgeMap[type] || {
      label: type ?? "Unknown",
      className: "bg-gray-100 text-gray-800 border-gray-200",
      borderColor: "border-l-gray-500",
    }
  );
};

const extractSubs = (raw?: SubmissionData): Submission[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && "submissions" in raw)
    return (raw as { submissions: Submission[] }).submissions;
  return [];
};

const formatDateTime = (iso: string | Date) => {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.toLocaleDateString()} at ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
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

  const [filter, setFilter] = useState<
    "all" | "correct" | "incorrect" | "unattempted"
  >("all");
  const [sortOrder, setSortOrder] = useState<"new" | "old">("new");
  const [latestOnly, setLatestOnly] = useState(false);

  const [gradeDraft, setGradeDraft] = useState<string>("");
  const [gradeSaved, setGradeSaved] = useState<number | null>(null);
  const [gradeSaving, setGradeSaving] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);

  const selectedStudent = students[selectedIndex] ?? null;

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
    setGradeSaved(null);
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
            setGradeSaved(grade);
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
        setGradeError(json?.error || "Failed to save grade");
      } else {
        setGradeSaved(Number(gradeDraft));
      }
    } catch {} finally {
      setGradeSaving(false);
    }
  };
  const clearGrade = () => {
    setGradeDraft("");
    setGradeSaved(null);
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
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant={filter === "all" ? "secondary" : "ghost"}
                    onClick={() => setFilter("all")}
                    aria-pressed={filter === "all"}
                  >
                    All
                  </Button>
                  <Button
                    size="sm"
                    variant={filter === "correct" ? "secondary" : "ghost"}
                    onClick={() => setFilter("correct")}
                    aria-pressed={filter === "correct"}
                  >
                    Correct
                  </Button>
                  <Button
                    size="sm"
                    variant={filter === "incorrect" ? "secondary" : "ghost"}
                    onClick={() => setFilter("incorrect")}
                    aria-pressed={filter === "incorrect"}
                  >
                    Incorrect
                  </Button>
                  <Button
                    size="sm"
                    variant={filter === "unattempted" ? "secondary" : "ghost"}
                    onClick={() => setFilter("unattempted")}
                    aria-pressed={filter === "unattempted"}
                  >
                    Unattempted
                  </Button>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    Latest only
                    <Switch
                      checked={latestOnly}
                      onCheckedChange={setLatestOnly}
                      aria-label="Show latest only"
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setSortOrder((s) => (s === "new" ? "old" : "new"))
                    }
                  >
                    {sortOrder === "new" ? "Newest first" : "Oldest first"}
                  </Button>
                </div>
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
              <div className="flex items-center gap-2">
                <div className="text-sm text-muted-foreground">Grade</div>
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
                    className={`h-9 w-[90px] pr-8 ${
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
                >
                  {gradeSaving ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="ghost" onClick={clearGrade}>
                  Clear
                </Button>
              </div>
            </div>

            {gradeError && (
              <div className="mt-1 text-sm text-red-600">{gradeError}</div>
            )}
            {gradeSaved !== null && (
              <div className="mt-1 text-xs text-muted-foreground">
                Saved grade: <span className="font-medium">{gradeSaved}</span>
                /100
              </div>
            )}
          </CardHeader>

          <CardContent>
            <div className="space-y-6">
              {problems.map((problem, idx) => {
                const subsAll = extractSubs(submissions[problem.id]);
                const isExpanded = expandedProblems[problem.id] || false;

                const hasAny = subsAll.length > 0;
                const anyCorrect = subsAll.some((s) => s.correct === true);

                const typeProps = getProblemTypeBadgeProps(problem.type ?? null);
                const typeBorderClass =
                  typeProps?.borderColor || "border-l-gray-500";

                // filtered submissions per controls
                let filtered = [...subsAll].sort(
                  (a, b) =>
                    new Date(a.submittedAt).getTime() -
                    new Date(b.submittedAt).getTime()
                );
                if (sortOrder === "new") filtered.reverse();
                if (latestOnly && filtered.length > 0) filtered = [filtered[0]];
                if (filter === "correct")
                  filtered = filtered.filter((s) => s.correct === true);
                if (filter === "incorrect")
                  filtered = filtered.filter((s) => s.correct === false);
                if (filter === "unattempted") filtered = [];

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
                          <Badge
                            variant="outline"
                            className="border-gray-200 text-gray-600"
                          >
                            Attempts: {subsAll.length}
                          </Badge>
                          {problem.type && (
                            <Badge
                              variant="outline"
                              className={typeProps?.className}
                            >
                              {typeProps?.label}
                            </Badge>
                          )}
                          {problem.maxStates !== undefined && (
                            <Badge
                              variant="outline"
                              className="border-green-200 bg-green-100 text-green-800"
                            >
                              Max States:{" "}
                              {problem.maxStates === -1
                                ? "Unlimited"
                                : problem.maxStates}
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className="border-purple-200 bg-purple-100 text-purple-800"
                          >
                            Deterministic:{" "}
                            {problem.isDeterministic ? "Yes" : "No"}
                          </Badge>
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
                      <div className="grid gap-4 lg:grid-cols-3">
                        {/* submissions: 2/3 */}
                        <section className="m-0 p-0 lg:col-span-2">
                          <div className="p-0">
                            {filter === "unattempted" && !hasAny && (
                              <p className="text-sm text-muted-foreground ">
                                No submissions yet.
                              </p>
                            )}

                            {filter !== "unattempted" && filtered.length > 0 ? (
                              <div className="rounded-md border bg-card">
                                <Table>
                                  <TableHeader>
                                    <TableRow className="bg-accent/40">
                                      <TableHead>Submitted At</TableHead>
                                      <TableHead>File</TableHead>
                                      <TableHead>Correct</TableHead>
                                      <TableHead>Feedback</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {filtered.map((submission) => (
                                      <TableRow key={submission.id}>
                                        <TableCell>
                                          {formatDateTime(
                                            submission.submittedAt
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          {submission.originalFileName &&
                                          submission.fileName ? (
                                            <a
                                              href={`/uploads/${submission.fileName}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="flex items-center gap-1 underline hover:text-blue-700"
                                            >
                                              <Download className="h-4 w-4" />
                                              {submission.originalFileName}
                                            </a>
                                          ) : (
                                            <span className="text-muted-foreground">
                                              No file
                                            </span>
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          {submission.correct !== null &&
                                          submission.correct !== undefined ? (
                                            <span
                                              className={`rounded-full px-2 py-1 text-xs font-medium ${
                                                submission.correct
                                                  ? "bg-green-100 text-green-800"
                                                  : "bg-red-100 text-red-800"
                                              }`}
                                            >
                                              {submission.correct
                                                ? "Correct"
                                                : "Incorrect"}
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground">
                                              Not checked
                                            </span>
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          {submission.feedback ? (
                                            <span className="text-sm">
                                              {submission.feedback}
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground">
                                              No feedback
                                            </span>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            ) : null}

                            {filter !== "unattempted" &&
                              filtered.length === 0 &&
                              hasAny && (
                                <p className="text-sm text-muted-foreground">
                                  No submissions match your filters.
                                </p>
                              )}
                          </div>
                        </section>

                        {/* discussion: 1/3 */}
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
                          className="lg:col-span-1"
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
