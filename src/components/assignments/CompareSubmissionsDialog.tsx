'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { JffCytoscapeViewer } from '@/components/JffViewerDialog';
import { CfgViewerContent } from '@/components/dialogs/CfgViewerDialog';
import { RegexViewerContent } from '@/components/dialogs/RegexViewerDialog';
import { apiPaths } from '@/lib/api-paths';
import type { MatchSubmission } from '@/lib/similarity/matches';

// Problem types drawn by the JFLAP (cytoscape) viewer; the rest have their own renderer.
const JFF_PROBLEM_TYPES = ['FA', 'PDA', 'TM'];

const studentName = (student: MatchSubmission['student']) =>
  `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() || 'Unknown student';

/** One submission rendered in whatever way its problem type is read. */
function SubmissionPane({
  submission,
  problemType,
  epsSymbol,
  formatSubmittedAt,
}: {
  submission: MatchSubmission;
  problemType: string | null;
  epsSymbol?: string;
  formatSubmittedAt: (iso: string) => string;
}) {
  const name = studentName(submission.student);
  const src = submission.fileName
    ? apiPaths.files.submission(encodeURIComponent(submission.fileName))
    : null;

  return (
    <section className="flex min-w-0 flex-col rounded-md border" aria-label={`${name}'s submission`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{name}</div>
          <div className="text-muted-foreground text-xs">
            {formatSubmittedAt(submission.submittedAt)}
            {submission.studentGroup ? ` · Group: ${submission.studentGroup.name}` : ''}
          </div>
        </div>
        {src ? (
          <Button variant="secondary" size="sm" asChild>
            <a
              href={apiPaths.files.submission(encodeURIComponent(submission.fileName as string), {
                download: true,
              })}
              download={submission.originalFileName ?? 'submission'}
              aria-label={`Download ${name}'s submission`}
            >
              <Download />
            </a>
          </Button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {!src ? (
          <p className="text-muted-foreground p-4 text-sm">This submission has no file.</p>
        ) : JFF_PROBLEM_TYPES.includes(problemType ?? '') ? (
          // `fill` so the viewer takes the pane's height rather than its own; two of these
          // at their default height would push the second one off the screen.
          <JffCytoscapeViewer src={src} fill epsSymbol={epsSymbol} honorPositionsDefault />
        ) : problemType === 'CFG' ? (
          <CfgViewerContent src={src} epsSymbol={epsSymbol} />
        ) : problemType === 'RE' ? (
          <RegexViewerContent src={src} />
        ) : (
          <p className="text-muted-foreground p-4 text-sm">
            This problem type has no viewer; download the files to compare them.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Two submissions side by side.
 *
 * The whole job of this page is deciding whether two files are the same work, and that is
 * a judgement a reader makes by looking. Opening them one at a time asked them to hold the
 * first in their head while they looked at the second.
 *
 * Node positions are honoured rather than re-laid-out, because where a student put their
 * states is exactly the thing that separates a copied file from the same answer worked out
 * twice: an automatic layout would make every correct answer look identical.
 */
export function CompareSubmissionsDialog({
  open,
  onOpenChange,
  submissions,
  problemType,
  problemTitle,
  epsSymbol,
  formatSubmittedAt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The two being compared. More than two are opened as pairs from the card. */
  submissions: [MatchSubmission, MatchSubmission] | null;
  problemType: string | null;
  problemTitle: string | null;
  epsSymbol?: string;
  formatSubmittedAt: (iso: string) => string;
}) {
  if (!submissions) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-w-[min(96vw,80rem)] flex-col">
        <DialogHeader>
          <DialogTitle className="leading-snug break-words">
            {problemTitle ?? 'Submissions'}: {studentName(submissions[0].student)} and{' '}
            {studentName(submissions[1].student)}
          </DialogTitle>
        </DialogHeader>

        {/* One column on a narrow screen: side by side below about 900px is two unreadable
            halves rather than a comparison. */}
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
          {submissions.map((submission) => (
            <SubmissionPane
              key={submission.id}
              submission={submission}
              problemType={problemType}
              epsSymbol={epsSymbol}
              formatSubmittedAt={formatSubmittedAt}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
