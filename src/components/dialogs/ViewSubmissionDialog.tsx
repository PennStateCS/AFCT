'use client';

import { apiPaths } from '@/lib/api-paths';
import { SubmissionViewerDialog } from '@/components/dialogs/SubmissionViewerDialog';

type ViewSubmissionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submission: {
    fileName: string | null;
    originalFileName: string | null;
    problem: { type?: string | null };
  } | null;
};

export function ViewSubmissionDialog({ open, onOpenChange, submission }: ViewSubmissionDialogProps) {
  if (!submission?.fileName) {
    return null;
  }

  return (
    <SubmissionViewerDialog
      open={open}
      onOpenChange={onOpenChange}
      problemType={submission.problem.type}
      src={apiPaths.files.submission(encodeURIComponent(submission.fileName))}
      title={`${submission.originalFileName || submission.fileName} - Submission`}
      width="70vw"
      height="70vh"
      showGridDefault={true}
    />
  );
}
