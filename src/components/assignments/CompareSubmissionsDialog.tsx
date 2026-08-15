'use client';

import { useEffect, useMemo, useState } from 'react';
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

/**
 * The two submissions closest together in time.
 *
 * Every file in a match holds the same work, so which two are shown is not about the
 * content: it is about which pair a reader wants to look at first, and that is the pair
 * with the least time between them.
 */
function closestPair(submissions: MatchSubmission[]): [string, string] {
  let best: [string, string] = [submissions[0]?.id ?? '', submissions[1]?.id ?? ''];
  let bestGap = Infinity;
  for (let i = 0; i < submissions.length; i++) {
    for (let j = i + 1; j < submissions.length; j++) {
      const a = submissions[i]!;
      const b = submissions[j]!;
      const gap = Math.abs(Date.parse(a.submittedAt) - Date.parse(b.submittedAt));
      if (gap < bestGap) {
        bestGap = gap;
        best = [a.id, b.id];
      }
    }
  }
  return best;
}

/** One submission rendered in whatever way its problem type is read. */
function SubmissionPane({
  submission,
  problemType,
  epsSymbol,
  formatSubmittedAt,
  choices,
  onChoose,
  side,
}: {
  submission: MatchSubmission;
  problemType: string | null;
  epsSymbol?: string;
  formatSubmittedAt: (iso: string) => string;
  /** Everyone this side could be swapped to. Empty when there is no choice to make. */
  choices: MatchSubmission[];
  onChoose: (submissionId: string) => void;
  side: 'left' | 'right';
}) {
  const name = studentName(submission.student);
  const src = submission.fileName
    ? apiPaths.files.submission(encodeURIComponent(submission.fileName))
    : null;
  const selectId = `compare-${side}-student`;

  return (
    <section className="min-w-0 rounded-md border" aria-label={`${name}'s submission`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="min-w-0">
          {choices.length > 0 ? (
            <>
              <label htmlFor={selectId} className="sr-only">
                {side === 'left' ? 'Left' : 'Right'} submission
              </label>
              <select
                id={selectId}
                className="bg-card border-input max-w-full rounded border px-2 py-1 font-medium"
                value={submission.id}
                onChange={(event) => onChoose(event.target.value)}
              >
                {choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {studentName(choice.student)}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <div className="truncate font-medium">{name}</div>
          )}
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

      <div className="overflow-auto">
        {!src ? (
          <p className="text-muted-foreground p-4 text-sm">This submission has no file.</p>
        ) : JFF_PROBLEM_TYPES.includes(problemType ?? '') ? (
          // A definite height rather than `fill`: cytoscape fits the graph to its container
          // once, at mount, and a flex child that has not settled yet measures as nothing,
          // which is how both machines ended up drawn in a corner.
          <JffCytoscapeViewer src={src} height="58vh" epsSymbol={epsSymbol} honorPositionsDefault />
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
 * Two submissions from a match, side by side.
 *
 * The whole job of this page is deciding whether two files are the same work, and that is
 * a judgement a reader makes by looking. Opening them one at a time asked them to hold the
 * first in their head while they looked at the second.
 *
 * A match can hold more than two students, so each side can be swapped to anyone else in
 * it; it opens on the pair closest together in time. Node positions are honoured rather
 * than re-laid-out, because where a student put their states is exactly what separates a
 * copied file from the same answer worked out twice: an automatic layout would make every
 * correct answer look identical.
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
  /** Every student in the match, one submission each. Two or more. */
  submissions: MatchSubmission[] | null;
  problemType: string | null;
  problemTitle: string | null;
  epsSymbol?: string;
  formatSubmittedAt: (iso: string) => string;
}) {
  const [pair, setPair] = useState<[string, string] | null>(null);

  // Reset whenever a different match is opened, so the dialog never shows the pair from
  // the card the reader looked at before this one.
  const initial = useMemo(() => (submissions ? closestPair(submissions) : null), [submissions]);
  useEffect(() => setPair(initial), [initial]);

  if (!submissions || submissions.length < 2 || !pair) return null;

  const byId = new Map(submissions.map((submission) => [submission.id, submission]));
  const left = byId.get(pair[0]) ?? submissions[0]!;
  const right = byId.get(pair[1]) ?? submissions[1]!;
  // Only offer a picker when there is something to pick, and never offer the side that is
  // already shown opposite: comparing a file with itself says nothing.
  const hasChoice = submissions.length > 2;
  const leftChoices = hasChoice ? submissions.filter((s) => s.id !== right.id) : [];
  const rightChoices = hasChoice ? submissions.filter((s) => s.id !== left.id) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `sm:` on purpose: DialogContent sets `sm:max-w-lg`, and an unprefixed max-w here
          does not replace it, so the dialog came out 32rem wide and each pane too narrow to
          read. */}
      <DialogContent className="sm:max-w-[min(96vw,80rem)]">
        <DialogHeader>
          <DialogTitle className="leading-snug break-words">
            {problemTitle ?? 'Submissions'}: {submissions.length} students submitted identical work
          </DialogTitle>
        </DialogHeader>

        {/* One column on a narrow screen: side by side below about 1024px is two unreadable
            halves rather than a comparison. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <SubmissionPane
            side="left"
            submission={left}
            problemType={problemType}
            epsSymbol={epsSymbol}
            formatSubmittedAt={formatSubmittedAt}
            choices={leftChoices}
            onChoose={(id) => setPair([id, right.id])}
          />
          <SubmissionPane
            side="right"
            submission={right}
            problemType={problemType}
            epsSymbol={epsSymbol}
            formatSubmittedAt={formatSubmittedAt}
            choices={rightChoices}
            onChoose={(id) => setPair([left.id, id])}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
