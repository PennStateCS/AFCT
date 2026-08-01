import type { Dispatch, SetStateAction } from 'react';
import type { Submission } from '@prisma/client';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';

export type RerunSubmissionOptions = {
  submission: Submission;
  setRerunning: Dispatch<SetStateAction<Record<string, boolean>>>;
  fetchReviewData: () => Promise<void>;
};

export async function rerunSubmission({
  submission,
  setRerunning,
  fetchReviewData,
}: RerunSubmissionOptions): Promise<void> {
  if (!submission?.id) return;

  setRerunning((prev) => ({ ...prev, [submission.id]: true }));
  try {
    const res = await fetch(apiPaths.submissionRerun(submission.id), {
      method: 'POST',
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(
        error?.error ||
          'Could not re-evaluate the submission. Check your connection and try again.',
      );
    }

    showToast.success('Submission re-evaluated');
    await fetchReviewData();
  } catch (err) {
    console.error('Rerun submission error:', err);
    showToast.error(
      err instanceof Error
        ? err.message
        : 'Could not re-evaluate the submission. Check your connection and try again.',
    );
  } finally {
    setRerunning((prev) => ({ ...prev, [submission.id]: false }));
  }
}
