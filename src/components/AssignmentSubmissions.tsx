'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { DataTable } from './ui/data-table';
import { Textarea } from './ui/textarea';
import { Submission, User } from '@prisma/client';
import { toast } from 'sonner';
import { ConfirmDialog } from './dialogs/ConfirmDialog';

type Person = Pick<User, 'firstName' | 'lastName' | 'id'>;

type Problem = {
  id: string;
  title: string;
  description?: string;
  type?: string;
  maxStates?: number;
  isDeterministic?: boolean;
};

type Comment = {
  id: string;
  content: string;
  createdAt: string;
  author: {
    firstName: string | null;
    lastName: string | null;
  };
};

type Props = {
  courseId: string;
  assignmentId: string;
  problems: Problem[];
};

const problemTypeLabels: Record<string, string> = {
  FA: 'Finite Automaton',
  PDA: 'Pushdown Automaton',
  CFG: 'Context-Free Grammar',
  RE: 'Regular Expression',
};

export default function AssignmentSubmissions({ courseId, assignmentId, problems }: Props) {
  const [students, setStudents] = useState<Person[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [submissions, setSubmissions] = useState<Record<string, Submission[]>>({});
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});
  const [savingComments, setSavingComments] = useState<Record<string, boolean>>({});
  const [deletingComments, setDeletingComments] = useState<Record<string, boolean>>({});
  const [commentToDelete, setCommentToDelete] = useState<{ id: string; problemId: string } | null>(
    null,
  );

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

  const handleSelectChange = (id: string) => {
    const index = students.findIndex((s) => s.id === id);
    if (index !== -1) setSelectedIndex(index);
  };

  const goPrev = () => setSelectedIndex((prev) => Math.max(0, prev - 1));
  const goNext = () => setSelectedIndex((prev) => Math.min(students.length - 1, prev + 1));

  return (
    <div>
      <div className="mb-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
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
        </div>

        {selectedStudent && (
          <span className="text-muted-foreground text-sm">
            {selectedIndex + 1} of {students.length}
          </span>
        )}
      </div>

      {selectedStudent && (
        <div className="space-y-4">
          {problems.map((problem) => {
            return (
              <div key={problem.id} className="bg-background mb-15 rounded border p-4 shadow-sm">
                <div className="mb-2 flex items-start gap-4 rounded border bg-white p-4 shadow">
                  <div className="mb-4 flex-1">
                    <div className="mb-4 text-lg font-bold">Problem: {problem.title}</div>

                    <div className="flex flex-wrap items-center gap-x-6 border-t-2 border-b-2 pt-2 pb-2 text-sm">
                      <div>
                        <strong>Type:&nbsp;</strong>
                        {problemTypeLabels[problem.type ?? ''] || problem.type || 'Unknown'}
                      </div>

                      {problem.maxStates !== undefined && (
                        <div>
                          <strong>Max States:&nbsp;</strong>{' '}
                          {problem.maxStates === -1 ? 'Unlimited' : problem.maxStates}
                        </div>
                      )}

                      <div>
                        <strong>Deterministic:&nbsp;</strong> {problem.isDeterministic ? 'Yes' : 'No'}
                      </div>
                    </div>
                    <div className="mt-4 mb-4 text-sm">{problem.description}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div className="rounded border bg-white p-4 shadow">
                    <div className="text-md pb-4 font-semibold">Submissions</div>

                    {(() => {
                      const subsRaw = submissions[problem.id];
                      let subs: any[] = [];
                      if (Array.isArray(subsRaw)) {
                        subs = subsRaw;
                      } else if (subsRaw && Array.isArray(subsRaw.submissions)) {
                        subs = subsRaw.submissions;
                      }
                      return subs.length ? (
                        <DataTable
                          columns={[
                            {
                              accessorKey: 'submittedAt',
                              header: 'Submitted At',
                              cell: ({ getValue }) => new Date(getValue<string>()).toLocaleString(),
                            },
                            {
                              accessorKey: 'feedback',
                              header: 'System Feedback',
                              cell: ({ getValue }) => getValue() || 'None',
                            },
                            {
                              accessorKey: 'originalFileName',
                              header: 'File',
                              cell: ({ row }) => {
                                const original = row.original.originalFileName;
                                const file = row.original.fileName;
                                if (original && file) {
                                  return (
                                    <a
                                      href={`/uploads/submissions/${file}`}
                                      download={original}
                                      className="text-blue-600 underline hover:text-blue-800"
                                    >
                                      {original}
                                    </a>
                                  );
                                }
                                return 'No File';
                              },
                            },
                          ]}
                          data={subs}
                        />
                      ) : (
                        <div className="p-15 text-center italic">No submissions</div>
                      );
                    })()}
                  </div>

                  <div className="rounded border bg-white p-4 shadow">
                    <div className="text-md pb-4 font-semibold">Comments</div>

                    {/* Display existing comments */}
                    {comments[problem.id]?.length > 0 ? (
                      <div className="mb-4 space-y-2">
                        {comments[problem.id].map((comment) => (
                          <div
                            key={comment.id}
                            className="border-primary relative rounded border-r-4 border-l-4 bg-gray-100 py-2 pr-10 pl-3"
                          >
                            <div className="mb-4 text-sm whitespace-pre-wrap">{comment.content}</div>
                            <div className="text-sm font-medium text-gray-900">
                              {comment.author.firstName} {comment.author.lastName}
                            </div>
                            <div className="text-xs text-gray-600 italic">
                              {new Date(comment.createdAt).toLocaleString()}
                            </div>

                            {/* Delete button - only show if not currently deleting */}
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

                            {/* Show loading state on delete button */}
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
                    ) : (
                      <div className="mb-4 text-sm text-gray-500 italic">No comments.</div>
                    )}

                    <Textarea
                      placeholder="Add a comment..."
                      value={commentTexts[problem.id] || ''}
                      onChange={(e) =>
                        setCommentTexts((prev) => ({ ...prev, [problem.id]: e.target.value }))
                      }
                    />
                    <Button
                      variant="default"
                      onClick={() => saveComment(problem.id)}
                      disabled={savingComments[problem.id]}
                      className="mt-4 flex items-center gap-x-1"
                    >
                      {savingComments[problem.id] ? 'Saving...' : 'Save Comment'}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
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
