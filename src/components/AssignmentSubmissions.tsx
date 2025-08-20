'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Trash2, MessageSquare, Send, FileText, Eye, EyeOff, BookOpen, Download, CheckCircle, XCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Submission, User } from '@prisma/client';
import { toast } from 'sonner';
import { ConfirmDialog } from './dialogs/ConfirmDialog';
import { Badge as RoleBadge } from '@/components/ui/RoleBadge';

type Person = Pick<User, 'firstName' | 'lastName' | 'id'>;

type Problem = {
  id: string;
  title: string;
  description?: string;
  type?: string;
  maxStates?: number;
  isDeterministic?: boolean;
};

type SubmissionData = Submission[] | { submissions: Submission[] };

type Comment = {
  id: string;
  content: string;
  createdAt: string;
  author: {
    firstName: string | null;
    lastName: string | null;
    role?: 'STUDENT' | 'FACULTY' | 'ADMIN' | 'TA';
  };
};

type Props = {
  courseId: string;
  assignmentId: string;
  problems: Problem[];
};

// Helper function to get problem type badge props (same as student view)
const getProblemTypeBadgeProps = (type: string | null) => {
  if (!type) return null;
  
  const badgeMap: Record<string, { label: string; className: string; borderColor: string }> = {
    PDA: { 
      label: 'Pushdown Automaton', 
      className: 'bg-purple-100 text-purple-800 border-purple-200',
      borderColor: 'border-l-purple-500'
    },
    RE: { 
      label: 'Regular Expression', 
      className: 'bg-blue-100 text-blue-800 border-blue-200',
      borderColor: 'border-l-blue-500'
    },
    CFG: { 
      label: 'Context-Free Grammar', 
      className: 'bg-green-100 text-green-800 border-green-200',
      borderColor: 'border-l-green-500'
    },
    FA: { 
      label: 'Finite Automaton', 
      className: 'bg-orange-100 text-orange-800 border-orange-200',
      borderColor: 'border-l-orange-500'
    }
  };
  
  return badgeMap[type] || { 
    label: type, 
    className: 'bg-gray-100 text-gray-800 border-gray-200',
    borderColor: 'border-l-gray-500'
  };
};

export default function AssignmentSubmissions({ courseId, assignmentId, problems }: Props) {
  const [students, setStudents] = useState<Person[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [submissions, setSubmissions] = useState<Record<string, SubmissionData>>({});
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});
  const [savingComments, setSavingComments] = useState<Record<string, boolean>>({});
  const [deletingComments, setDeletingComments] = useState<Record<string, boolean>>({});
  const [commentToDelete, setCommentToDelete] = useState<{ id: string; problemId: string } | null>(
    null,
  );
  const [expandedProblems, setExpandedProblems] = useState<Record<string, boolean>>({});

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
    fetch(`/api/courses/${courseId}/${assignmentId}/submissions/${selectedStudent.id}`)
      .then((res) => res.json())
      .then((data) => {
        setSubmissions(data || {});
      })
      .catch(() => setSubmissions({}));
  }, [courseId, assignmentId, selectedStudent]);

  // Load comments for all problems when a student is selected
  useEffect(() => {
    const loadComments = async () => {
      if (!selectedStudent) {
        setComments({});
        return;
      }

      const commentsData: Record<string, Comment[]> = {};

      for (const problem of problems) {
        try {
          const response = await fetch(
            `/api/comments?assignmentId=${assignmentId}&problemId=${problem.id}&studentId=${selectedStudent.id}`,
          );
          if (response.ok) {
            const problemComments = await response.json();
            commentsData[problem.id] = problemComments || [];
          } else {
            console.warn(`Failed to load comments for problem ${problem.id}:`, response.status);
            commentsData[problem.id] = [];
          }
        } catch (error) {
          console.error(`Error loading comments for problem ${problem.id}:`, error);
          commentsData[problem.id] = [];
        }
      }

      setComments(commentsData);
    };

    if (problems.length > 0) {
      loadComments();
    }
  }, [assignmentId, problems, selectedStudent]);

  const saveComment = async (problemId: string) => {
    const commentText = commentTexts[problemId]?.trim();
    if (!commentText) {
      toast.error('Please enter a comment before saving.');
      return;
    }

    if (!selectedStudent) {
      toast.error('No student selected.');
      return;
    }

    setSavingComments((prev) => ({ ...prev, [problemId]: true }));

    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
        setCommentTexts((prev) => ({ ...prev, [problemId]: '' }));
        toast.success('Comment saved successfully!');
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to save comment');
      }
    } catch (error) {
      console.error('Error saving comment:', error);
      toast.error('Failed to save comment');
    } finally {
      setSavingComments((prev) => ({ ...prev, [problemId]: false }));
    }
  };

  const deleteComment = async (commentId: string, problemId: string) => {
    setDeletingComments((prev) => ({ ...prev, [commentId]: true }));

    try {
      const response = await fetch(`/api/comments?commentId=${commentId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setComments((prev) => ({
          ...prev,
          [problemId]: prev[problemId]?.filter((comment) => comment.id !== commentId) || [],
        }));
        toast.success('Comment deleted successfully!');
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to delete comment');
      }
    } catch (error) {
      console.error('Error deleting comment:', error);
      toast.error('Failed to delete comment');
    } finally {
      setDeletingComments((prev) => ({ ...prev, [commentId]: false }));
    }
  };

  const handleDeleteClick = (commentId: string, problemId: string) => {
    setCommentToDelete({ id: commentId, problemId });
  };

  const handleConfirmDelete = () => {
    if (commentToDelete) {
      deleteComment(commentToDelete.id, commentToDelete.problemId);
      setCommentToDelete(null);
    }
  };

  const handleCancelDelete = () => {
    setCommentToDelete(null);
  };

  const toggleProblemExpansion = (problemId: string) => {
    setExpandedProblems(prev => ({
      ...prev,
      [problemId]: !prev[problemId]
    }));
  };

  const toggleAllProblems = () => {
    const allExpanded = problems.every(problem => expandedProblems[problem.id]);
    const newState: Record<string, boolean> = {};
    
    problems.forEach(problem => {
      newState[problem.id] = !allExpanded;
    });
    
    setExpandedProblems(newState);
  };

  const handleSelectChange = (id: string) => {
    const index = students.findIndex((s) => s.id === id);
    if (index !== -1) setSelectedIndex(index);
  };

  const goPrev = () => setSelectedIndex((prev) => Math.max(0, prev - 1));
  const goNext = () => setSelectedIndex((prev) => Math.min(students.length - 1, prev + 1));

  return (
    <div>
      <div className="mb-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
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
            value={selectedStudent?.id ?? ''}
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

          {selectedStudent && (
            <span className="text-muted-foreground text-sm ml-2">
              {selectedIndex + 1} of {students.length}
            </span>
          )}
        </div>

        {selectedStudent && (
          <Button
            variant="outline"
            size="sm"
            onClick={toggleAllProblems}
            className="flex items-center gap-x-1"
          >
            {problems.every(problem => expandedProblems[problem.id]) ? (
              <>
                <EyeOff className="h-4 w-4" />
                Hide All
              </>
            ) : (
              <>
                <Eye className="h-4 w-4" />
                Show All
              </>
            )}
          </Button>
        )}
      </div>

      {selectedStudent && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5" />
              Problems & Submissions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {problems.map((problem, idx) => {
                const subsRaw = submissions[problem.id];
                let subs: Submission[] = [];
                if (Array.isArray(subsRaw)) {
                  subs = subsRaw;
                } else if (subsRaw && typeof subsRaw === 'object' && 'submissions' in subsRaw) {
                  subs = (subsRaw as { submissions: Submission[] }).submissions;
                }

                const isExpanded = expandedProblems[problem.id] || false;

                return (
                  <div key={problem.id} className={`border rounded-lg p-4 border-l-4 ${getProblemTypeBadgeProps(problem.type ?? null)?.borderColor || 'border-l-gray-500'}`}>
                    {/* Problem Header */}
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                          Problem {idx + 1}: {problem.title}
                          {subs.some(sub => sub.correct === true) ? (
                            <Badge className="bg-green-100 text-green-800 border-green-200 flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" />
                              Correct
                            </Badge>
                          ) : (subs.length === 0 || !subs.some(sub => sub.correct === true)) && (
                            <Badge className="bg-red-100 text-red-800 border-red-200 flex items-center gap-1">
                              <XCircle className="w-3 h-3" />
                              Incorrect
                            </Badge>
                          )}
                        </h3>
                        {problem.description && (
                          <p className="text-muted-foreground mt-1">{problem.description}</p>
                        )}
                        <div className="flex gap-4 mt-2 text-sm text-muted-foreground items-center">
                          {problem.type && (
                            <div className="flex items-center gap-2">
                              <Badge 
                                variant="outline" 
                                className={getProblemTypeBadgeProps(problem.type ?? null)?.className}
                              >
                                {getProblemTypeBadgeProps(problem.type ?? null)?.label}
                              </Badge>
                            </div>
                          )}
                          {problem.maxStates !== undefined && (
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">
                                Max States: {problem.maxStates === -1 ? 'Unlimited' : problem.maxStates}
                              </Badge>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-200">
                              Deterministic: {problem.isDeterministic ? 'Yes' : 'No'}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleProblemExpansion(problem.id)}
                        >
                          {isExpanded ? (
                            <>
                              <EyeOff className="w-4 h-4 mr-2" />
                              Hide Details
                            </>
                          ) : (
                            <>
                              <Eye className="w-4 h-4 mr-2" />
                              Show Details
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Expandable Details */}
                    {isExpanded && (
                      <div className="space-y-4">
                        {/* Submissions Table */}
                        <div>
                          <h4 className="font-medium mb-2 flex items-center gap-2">
                            <FileText className="w-4 h-4" />
                            Student Submissions ({subs.length})
                          </h4>
                          {subs.length > 0 ? (
                            <div className="border rounded-lg">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Submitted At</TableHead>
                                    <TableHead>File</TableHead>
                                    <TableHead>Correct</TableHead>
                                    <TableHead>Feedback</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {subs
                                    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime())
                                    .map((submission) => {
                                    return (
                                      <TableRow key={submission.id}>
                                        <TableCell>
                                          {new Date(submission.submittedAt).toLocaleDateString()} at {new Date(submission.submittedAt).toLocaleTimeString()}
                                        </TableCell>
                                        <TableCell>
                                          {submission.originalFileName && submission.fileName ? (
                                            <a 
                                              href={`/uploads/${submission.fileName}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-blue-600 hover:text-blue-800 underline flex items-center gap-1"
                                            >
                                              <Download className="w-4 h-4" />
                                              {submission.originalFileName}
                                            </a>
                                          ) : (
                                            <span className="text-muted-foreground">No file</span>
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          {submission.correct !== null && submission.correct !== undefined ? (
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                              submission.correct ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                            }`}>
                                              {submission.correct ? 'Correct' : 'Incorrect'}
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground">Not checked</span>
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          {submission.feedback ? (
                                            <span className="text-sm">{submission.feedback}</span>
                                          ) : (
                                            <span className="text-muted-foreground">No feedback</span>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          ) : (
                            <p className="text-muted-foreground text-sm">No submissions yet.</p>
                          )}
                        </div>

                        {/* Comments Section */}
                        <div>
                          <h4 className="font-medium mb-2 flex items-center gap-2">
                            <MessageSquare className="w-4 h-4" />
                            Discussion ({comments[problem.id]?.length || 0})
                          </h4>
                          
                          {/* Existing Comments */}
                          {comments[problem.id]?.length > 0 && (
                            <div className="space-y-3 mb-4">
                              {comments[problem.id]
                                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                                .map((comment) => (
                                <div key={comment.id} className="bg-gray-50 rounded-lg p-3 relative">
                                  <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-sm">
                                        {comment.author.firstName} {comment.author.lastName}
                                      </span>
                                      {comment.author.role && (
                                        <RoleBadge role={comment.author.role} />
                                      )}
                                    </div>
                                    <span className="text-xs text-muted-foreground">
                                      {new Date(comment.createdAt).toLocaleDateString()} at {new Date(comment.createdAt).toLocaleTimeString()}
                                    </span>
                                  </div>
                                  <p className="text-sm">{comment.content}</p>

                                  {/* Delete button */}
                                  {!deletingComments[comment.id] && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleDeleteClick(comment.id, problem.id)}
                                      className="absolute top-2 right-2 h-auto p-1 text-red-500 hover:bg-red-50 hover:text-red-700"
                                      title="Delete comment"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  )}

                                  {deletingComments[comment.id] && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled
                                      className="absolute top-2 right-2 h-auto p-1 text-gray-400"
                                      title="Deleting comment..."
                                    >
                                      <Trash2 className="h-4 w-4 animate-pulse" />
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Add New Comment */}
                          <div className="space-y-2">
                            <Textarea
                              placeholder="Add a comment or feedback about this problem..."
                              value={commentTexts[problem.id] || ''}
                              onChange={(e) =>
                                setCommentTexts((prev) => ({ ...prev, [problem.id]: e.target.value }))
                              }
                              className="min-h-[80px]"
                            />
                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                onClick={() => saveComment(problem.id)}
                                disabled={!commentTexts[problem.id]?.trim() || savingComments[problem.id]}
                              >
                                {savingComments[problem.id] ? (
                                  'Submitting...'
                                ) : (
                                  <>
                                    <Send className="w-4 h-4 mr-2" />
                                    Add Comment
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        open={!!commentToDelete}
        title="Delete Comment"
        description="Are you sure you want to delete this comment? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}
