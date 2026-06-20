import type { Dispatch, SetStateAction } from 'react';
import type { Submission } from '@prisma/client';
import { showToast } from '@/lib/toast';

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
    const res = await fetch(`/api/submissions/${submission.id}/rerun`, {
      method: 'POST',
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error?.error || 'Failed to rerun submission');
    }

    showToast.success('Submission re-evaluated');
    await fetchReviewData();
  } catch (err) {
    console.error('Rerun submission error:', err);
    showToast.error(err instanceof Error ? err.message : 'Failed to rerun submission');
  } finally {
    setRerunning((prev) => ({ ...prev, [submission.id]: false }));
  }
}
