'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api/fetch-client';
import { errMessage } from '@/lib/errors';
import type { Comment as DiscussionComment } from './DiscussionPanel';
import type { ReviewDataResponse } from './useReviewData';

/** Who a new comment is addressed to. Only meaningful on a group assignment. */
export type CommentTarget = 'student' | 'group';

type UseCommentsArgs = {
  courseId: string;
  assignmentId: string;
  selectedStudentId: string | null;
  /** The selected student's group and groupmates, from review data. */
  group: { id: string; name: string } | null | undefined;
  groupMembers: { id: string }[] | undefined;
};

/**
 * The comment half of the submissions review page: the draft text per problem, the
 * in-flight flags, who a new comment is addressed to, and the two writes.
 *
 * Both writes update the review-data cache optimistically and then invalidate it, because
 * the rendered thread is derived from that cache rather than from state of its own.
 */
export function useComments({
  courseId,
  assignmentId,
  selectedStudentId,
  group,
  groupMembers,
}: UseCommentsArgs) {
  const queryClient = useQueryClient();

  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});
  const [savingComments, setSavingComments] = useState<Record<string, boolean>>({});
  const [deletingComments, setDeletingComments] = useState<Record<string, boolean>>({});

  // Defaults to the group: the shared submission is what staff are looking at, so that is
  // the common case. Reset per student so a private note to one person does not silently
  // carry over to the next.
  const [commentTarget, setCommentTarget] = useState<CommentTarget>('group');
  useEffect(() => {
    setCommentTarget('group');
  }, [selectedStudentId]);

  const setCommentText = useCallback((problemId: string, text: string) => {
    setCommentTexts((prev) => ({ ...prev, [problemId]: text }));
  }, []);

  const saveComment = useCallback(
    async (problemId: string) => {
      const commentText = commentTexts[problemId]?.trim();
      if (!commentText || !selectedStudentId) return;

      setSavingComments((prev) => ({ ...prev, [problemId]: true }));
      try {
        // A group comment is one row addressed to the group; an individual one names the
        // student. Sending both is refused by the API and by a database constraint.
        const toGroup = !!group && commentTarget === 'group';
        const newComment = await apiClient.post<DiscussionComment>(apiPaths.comments(), {
          content: commentText,
          assignmentId,
          problemId,
          ...(toGroup ? { groupId: group?.id } : { studentId: selectedStudentId }),
        });
        // Optimistically add the comment to the review-data cache (the derived
        // `comments` reads from it), then invalidate so the server copy replaces it.
        queryClient.setQueryData<ReviewDataResponse>(
          queryKeys.assignment.reviewData(courseId, assignmentId, selectedStudentId),
          (old) => ({
            ...old,
            comments: [...(old?.comments ?? []), { ...newComment, problemId }],
          }),
        );
        setCommentTexts((prev) => ({ ...prev, [problemId]: '' }));
        void queryClient.invalidateQueries({
          queryKey: queryKeys.assignment.reviewData(courseId, assignmentId, selectedStudentId),
        });
        // Review data is cached per student, so a comment addressed to the group would sit
        // unseen in every groupmate's cached copy until it went stale. Drop theirs too.
        if (toGroup) {
          for (const member of groupMembers ?? []) {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.assignment.reviewData(courseId, assignmentId, member.id),
            });
          }
        }
        showToast.saved('Comment');
      } catch (err) {
        console.error('Save comment error:', err);
        showToast.error(errMessage(err, 'Failed to save comment'));
      } finally {
        setSavingComments((prev) => ({ ...prev, [problemId]: false }));
      }
    },
    [
      commentTexts,
      selectedStudentId,
      assignmentId,
      courseId,
      queryClient,
      // Without these the callback keeps whichever audience was current when it was last
      // built, which is how a note meant for one student ends up posted to their group.
      commentTarget,
      group,
      groupMembers,
    ],
  );

  const deleteComment = useCallback(
    async (commentId: string) => {
      setDeletingComments((prev) => ({ ...prev, [commentId]: true }));
      try {
        await apiClient.del(apiPaths.comments({ commentId }));
        // Optimistically drop the comment from the review-data cache (the derived
        // `comments` reads from it), then invalidate to reconcile with the server.
        queryClient.setQueryData<ReviewDataResponse>(
          queryKeys.assignment.reviewData(courseId, assignmentId, selectedStudentId ?? ''),
          (old) =>
            old
              ? { ...old, comments: (old.comments ?? []).filter((c) => c.id !== commentId) }
              : old,
        );
        void queryClient.invalidateQueries({
          queryKey: queryKeys.assignment.reviewData(
            courseId,
            assignmentId,
            selectedStudentId ?? '',
          ),
        });
        showToast.deleted('Comment');
      } catch (err) {
        console.error('Delete comment error:', err);
        showToast.error(errMessage(err, 'Failed to delete comment'));
      } finally {
        setDeletingComments((prev) => ({ ...prev, [commentId]: false }));
      }
    },
    [courseId, assignmentId, selectedStudentId, queryClient],
  );

  return {
    commentTexts,
    setCommentText,
    savingComments,
    deletingComments,
    commentTarget,
    setCommentTarget,
    saveComment,
    deleteComment,
  };
}
