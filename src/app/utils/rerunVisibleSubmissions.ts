import type { Dispatch, SetStateAction } from 'react';
import type { ProblemSubmission } from '@/lib/problem-submission';
import { showToast } from '@/lib/toast';

export type RerunVisibleSubmissionsOptions = {
  visibleSubmissions: ProblemSubmission[];
  setRerunning: Dispatch<SetStateAction<Record<string, boolean>>>;
  fetchReviewData: () => Promise<void>;
};

export async function rerunVisibleSubmissions({
  visibleSubmissions,
  setRerunning,
  fetchReviewData,
}: RerunVisibleSubmissionsOptions): Promise<void> {
  if (!visibleSubmissions?.length) return;

  const uniqueSubmissions = Array.from(
    new Map(
      visibleSubmissions
        .filter((submission) => submission?.id)
        .map((submission) => [submission.id, submission]),
    ).values(),
  );

  setRerunning((prev) => {
    const next = { ...prev };
    uniqueSubmissions.forEach((submission) => {
      if (submission.id) next[submission.id] = true;
    });
    return next;
  });

  try {
    const results = await Promise.allSettled(
      uniqueSubmissions.map((submission) =>
        fetch(`/api/submissions/${submission.id}/rerun`, {
          method: 'POST',
        }),
      ),
    );

    const failures = results.filter(
      (result) =>
        result.status === 'rejected' ||
        (result.status === 'fulfilled' && !result.value.ok),
    );

    if (failures.length > 0) {
      showToast.error(
        failures.length === 1
          ? 'One submission failed to rerun.'
          : `${failures.length} submissions failed to rerun.`,
      );
    } else {
      showToast.success('Visible submissions are being re-evaluated');
    }

    await fetchReviewData();
  } catch (err) {
    console.error('Bulk rerun submission error:', err);
    showToast.error(
      err instanceof Error
        ? err.message
        : 'Failed to rerun visible submissions',
    );
  } finally {
    setRerunning((prev) => {
      const next = { ...prev };
      uniqueSubmissions.forEach((submission) => {
        if (submission.id) next[submission.id] = false;
      });
      return next;
    });
  }
}
