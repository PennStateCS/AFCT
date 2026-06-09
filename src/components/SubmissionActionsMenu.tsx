import { Submission } from '@prisma/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Eye, RefreshCw, Download, ChevronDown, FileText } from 'lucide-react';
import { useMemo } from 'react';

type SubmissionActionsMenuProps = {
  submission: Submission;
  rerunning: boolean;
  onView: (submission: Submission) => void;
  onRerun: (submission: Submission) => void;
};

const formatRawJson = (submission: Submission) => {
  const raw = submission.evaluationRaw;
  if (!raw) return null;
  return typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
};

const formatStatus = (status: string | null | undefined): string => {
  if (!status) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
};

export default function SubmissionActionsMenu({
  submission,
  rerunning,
  onView,
  onRerun,
}: SubmissionActionsMenuProps) {
  const rawJson = useMemo(() => formatRawJson(submission), [submission]);
  const rerunDisabled = rerunning || submission.status === 'PROCESSING';

  if (!submission.fileName) {
    return <span className="text-muted-foreground text-sm">No file</span>;
  }

  const handleDownload = () => {
    if (!submission.fileName) return;
    const url = `/api/uploads/submissions/${encodeURIComponent(submission.fileName)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary">
            <ChevronDown className="mr-1 h-4 w-4" /> Manage
          </Button>
        </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onView(submission)} className="flex items-center gap-2">
          <Eye className="h-4 w-4" /> View Solution
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onRerun(submission)}
          disabled={rerunDisabled}
          className="flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          {rerunDisabled ? (rerunning ? 'Rerunning…' : 'Cannot rerun (processing)') : 'Rerun Evaluator'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleDownload} className="flex items-center gap-2">
          <Download className="h-4 w-4" /> Download Submission
        </DropdownMenuItem>
        <Dialog>
          <DialogTrigger asChild>
            <DropdownMenuItem
              disabled={!rawJson}
              className="flex items-center gap-2"
              onSelect={(event) => event.preventDefault()}
            >
              <FileText className="h-4 w-4" /> View Raw JSON
            </DropdownMenuItem>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Raw evaluation JSON</DialogTitle>
            </DialogHeader>
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-white p-3 text-xs leading-relaxed text-slate-900">
              {rawJson ?? 'No raw JSON available.'}
            </pre>
          </DialogContent>
        </Dialog>
      </DropdownMenuContent>
    </DropdownMenu>
      <span className="text-xs text-rose-900 px-2 py-1 rounded bg-rose-100 font-medium">
        {formatStatus(submission.status)}
      </span>
    </div>
  );
}
