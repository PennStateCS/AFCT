'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Submission } from '@prisma/client';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import type { Comment as DiscussionComment } from './DiscussionPanel';

type SubmissionData = Submission[] | { submissions: Submission[] };

export type ReviewDataResponse = {
  submissions?: Record<string, SubmissionData>;
  comments?: Array<DiscussionComment & { problemId?: string | null }>;
  problemGrades?: Record<string, { grade: number | null; feedback: string | null }>;
  /** True when the selected student submits this assignment as a group. */
  isGroup?: boolean;
};

/**
 * The per-student review-data read for AssignmentSubmissions: submissions, comments, and
 * problem grades for the selected student. TanStack Query owns the fetch, cancellation
 * (via signal), and dedupe. Auth/not-found responses resolve to an empty payload (matching
 * the old silent handling) rather than erroring. Returns the query data plus a cold-load
 * `reviewFetching` flag (isPending, so a post-save background refetch doesn't blank the
 * workspace) and a stable `refreshReview` invalidator used by the rerun helpers.
 */
export function useReviewData(
  courseId: string,
  assignmentId: string,
  selectedStudentId: string | null,
) {
  const queryClient = useQueryClient();

  const reviewQuery = useQuery({
    queryKey: queryKeys.assignment.reviewData(courseId, assignmentId, selectedStudentId ?? ''),
    queryFn: async ({ signal }): Promise<ReviewDataResponse> => {
      const res = await fetch(
        apiPaths.assignmentReviewData(courseId, assignmentId, selectedStudentId ?? ''),
        { signal },
      );
      if (!res.ok) {
        // Match the previous silent handling of auth/not-found responses.
        if ([401, 403, 404].includes(res.status)) {
          return { submissions: {}, comments: [], problemGrades: {}, isGroup: false };
        }
        throw new Error((await res.json())?.error || 'Failed to load review data');
      }
      return ((await res.json()) ?? {}) as ReviewDataResponse;
    },
    enabled: !!selectedStudentId,
    staleTime: 30_000,
  });

  // Stable refresher used by the rerun helpers (they previously took fetchReviewData).
  const refreshReview = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.assignment.reviewData(courseId, assignmentId, selectedStudentId ?? ''),
    });
  }, [queryClient, courseId, assignmentId, selectedStudentId]);

  // isPending (not isFetching) so the spinner shows only on the cold load of a student's
  // data. After a grade/comment save invalidates review-data, the background refetch must
  // NOT blank the whole workspace back to a spinner.
  const reviewFetching = !!selectedStudentId && reviewQuery.isPending;

  return {
    reviewData: reviewQuery.data,
    reviewQueryIsError: reviewQuery.isError,
    reviewError: reviewQuery.error,
    reviewFetching,
    refreshReview,
  };
}
