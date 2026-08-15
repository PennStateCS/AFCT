'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Download, Eye } from 'lucide-react';
import { apiPaths } from '@/lib/api-paths';
import { getInitials } from '@/app/utils/initials';
import type { SubmissionMatchGroup, MatchSubmission } from '@/lib/similarity/matches';

type SubmissionMatchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: SubmissionMatchGroup | null;
  /** Opens the file itself in the submission viewer. */
  onViewSubmission: (submission: MatchSubmission) => void;
  formatSubmittedAt: (iso: string) => string;
};

const studentName = (student: MatchSubmission['student']) =>
  `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() || 'Unknown student';

/**
 * Everything behind one match: who submitted this identical content, when, and how common
 * that content is across the problem.
 *
 * The commonality line is the important one and is why it sits at the top rather than in a
 * column somewhere: identical work shared by most of the class is what a correct answer
 * looks like, and a reader needs that before they read the names.
 */
export function SubmissionMatchDialog({
  open,
  onOpenChange,
  group,
  onViewSubmission,
  formatSubmittedAt,
}: SubmissionMatchDialogProps) {
  if (!group) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Matching submissions</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted-foreground">Problem</dt>
            <dd>{group.problem.title ?? 'Unknown problem'}</dd>

            <dt className="text-muted-foreground">Identical work</dt>
            <dd>
              {group.studentCount} of {group.problemStudentCount} students who submitted this
              problem
            </dd>
          </dl>

          <p className="text-muted-foreground text-sm">
            These files are byte for byte the same once formatting is set aside. That is worth
            reading when few students share it, and expected when most of them do: an easy
            problem has one right answer, and a grammar or regular expression has no layout to
            differ in.
          </p>

          <ul className="divide-border divide-y rounded-md border">
            {group.submissions.map((submission) => {
              const name = studentName(submission.student);
              const fileLabel = submission.originalFileName ?? submission.fileName ?? 'File';
              return (
                <li key={submission.id} className="flex flex-wrap items-center gap-3 p-3">
                  <Avatar className="h-9 w-9">
                    <AvatarImage
                      src={
                        submission.student.avatar
                          ? apiPaths.files.pfp(submission.student.avatar)
                          : undefined
                      }
                      alt={name}
                      cropX={submission.student.cropX ?? 0.5}
                      cropY={submission.student.cropY ?? 0.5}
                      zoom={submission.student.zoom ?? 1}
                    />
                    <AvatarFallback>
                      {getInitials(submission.student.firstName, submission.student.lastName, undefined)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{name}</div>
                    <div className="text-muted-foreground text-xs">
                      {formatSubmittedAt(submission.submittedAt)}
                      {submission.studentGroup ? ` · Group: ${submission.studentGroup.name}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onViewSubmission(submission)}
                      disabled={!submission.fileName}
                      aria-label={`View ${name}'s submission`}
                    >
                      <Eye />
                      View
                    </Button>
                    {submission.fileName ? (
                      <Button variant="secondary" size="sm" asChild>
                        <a
                          href={apiPaths.files.submission(encodeURIComponent(submission.fileName), {
                            download: true,
                          })}
                          download={fileLabel}
                          aria-label={`Download ${name}'s submission`}
                        >
                          <Download />
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
