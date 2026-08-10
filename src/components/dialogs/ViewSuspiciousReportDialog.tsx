'use client';

import { apiPaths } from '@/lib/api-paths';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

type SuspiciousReportUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  cropX: number | null;
  cropY: number | null;
  zoom: number | null;
};

type SuspiciousReportSubmission = {
  id: string;
  submittedAt: string;
  fileName: string | null;
  originalFileName: string | null;
  isSuspicious: boolean | null;
  isSuspiciousOverride: boolean | null;
  isSuspiciousReason: string | null;
  student: SuspiciousReportUser;
  problem: {
    title: string | null;
    type: string | null;
  };
  studentGroup: { id: string; name: string } | null;
};

type ViewSuspiciousReportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: {
    isSuspicious: boolean | null;
    isSuspiciousOverride: boolean | null;
    isSuspiciousReason: string | null;
    fileHashUsers?: SuspiciousReportUser[];
    calcHashUsers?: SuspiciousReportUser[];
    fileHashSubmissions?: SuspiciousReportSubmission[];
    calcHashSubmissions?: SuspiciousReportSubmission[];
  } | null;
};

function profileName(user: SuspiciousReportUser) {
  return `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Unknown user';
}

function SubmissionRow({ submission }: { submission: SuspiciousReportSubmission }) {
  const fileName = submission.fileName;

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarImage
              src={submission.student.avatar ? apiPaths.files.pfp(submission.student.avatar) : undefined}
              alt={profileName(submission.student)}
              cropX={submission.student.cropX ?? 0.5}
              cropY={submission.student.cropY ?? 0.5}
              zoom={submission.student.zoom ?? 1}
            />
            <AvatarFallback>{(submission.student.firstName?.[0] ?? 'U').toUpperCase()}{(submission.student.lastName?.[0] ?? '').toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="font-medium">{profileName(submission.student)}</div>
            {submission.studentGroup ? (
              <div className="text-muted-foreground text-xs">Group: {submission.studentGroup.name}</div>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell>{submission.problem.title ?? 'Unknown'}</TableCell>
      <TableCell>{submission.submittedAt ? new Date(submission.submittedAt).toLocaleString() : 'Unknown'}</TableCell>
      <TableCell>
        {fileName ? (
          <Button
            variant="secondary"
            size="sm"
            asChild
            className="inline-flex items-center gap-2"
          >
            <a
              href={apiPaths.files.submission(encodeURIComponent(fileName))}
              download={submission.originalFileName ?? fileName}
              aria-label={`Download ${submission.originalFileName ?? fileName}`}
            >
              <Download className="h-4 w-4" />
            </a>
          </Button>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

export function ViewSuspiciousReportDialog({ open, onOpenChange, report }: ViewSuspiciousReportDialogProps) {
  const reasons = report?.isSuspiciousReason
    ? report.isSuspiciousReason.split(/\r?\n/).map((reason) => reason.trim()).filter(Boolean)
    : [];

  const suspiciousUsers = (() => {
    const users = new Map<
      string,
      { user: SuspiciousReportUser; earliestSubmission: Date | null }
    >();

    const addUser = (user: SuspiciousReportUser) => {
      if (!users.has(user.id)) {
        users.set(user.id, { user, earliestSubmission: null });
      }
    };

    const addSubmissionDate = (student: SuspiciousReportUser, submittedAt: string | null) => {
      if (!submittedAt) return;
      const date = new Date(submittedAt);
      if (Number.isNaN(date.getTime())) return;

      const entry = users.get(student.id);
      if (!entry) {
        users.set(student.id, { user: student, earliestSubmission: date });
        return;
      }

      if (!entry.earliestSubmission || date < entry.earliestSubmission) {
        entry.earliestSubmission = date;
      }
    };

    report?.fileHashUsers?.forEach(addUser);
    report?.calcHashUsers?.forEach(addUser);
    report?.fileHashSubmissions?.forEach((submission) => {
      addUser(submission.student);
      addSubmissionDate(submission.student, submission.submittedAt);
    });
    report?.calcHashSubmissions?.forEach((submission) => {
      addUser(submission.student);
      addSubmissionDate(submission.student, submission.submittedAt);
    });

    return Array.from(users.values()).sort((a, b) => {
      const lastA = (a.user.lastName ?? '').toLowerCase();
      const lastB = (b.user.lastName ?? '').toLowerCase();
      if (lastA !== lastB) return lastA.localeCompare(lastB);

      const firstA = (a.user.firstName ?? '').toLowerCase();
      const firstB = (b.user.firstName ?? '').toLowerCase();
      if (firstA !== firstB) return firstA.localeCompare(firstB);

      if (a.earliestSubmission && b.earliestSubmission) {
        return a.earliestSubmission.getTime() - b.earliestSubmission.getTime();
      }
      if (a.earliestSubmission) return -1;
      if (b.earliestSubmission) return 1;
      return 0;
    });
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suspicious Report</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Reasons</h3>
            <p className="text-sm text-muted-foreground">Reason details from the similarity detector.</p>
            {reasons.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                {reasons.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No report details available.</p>
            )}
          </div>
          <br />

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Suspicious users</h3>
              <p className="text-sm text-muted-foreground">All users with matching submissions.</p>
              {suspiciousUsers.length ? (
                <Table className="mt-2">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suspiciousUsers.map(({ user }) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage
                                src={user.avatar ? apiPaths.files.pfp(user.avatar) : undefined}
                                alt={profileName(user)}
                                cropX={user.cropX ?? 0.5}
                                cropY={user.cropY ?? 0.5}
                                zoom={user.zoom ?? 1}
                              />
                              <AvatarFallback>{(user.firstName?.[0] ?? 'U').toUpperCase()}{(user.lastName?.[0] ?? '').toUpperCase()}</AvatarFallback>
                            </Avatar>
                            {profileName(user)}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No suspicious users found.</p>
              )}
            </div>
            <br />

            <div>
              <h3 className="text-sm font-semibold">Matching Fingerprint ID</h3>
              <p className="text-sm text-muted-foreground">Submissions matched by a fingerprinted ID inside the file.</p>
              {report?.fileHashSubmissions?.length ? (
                <Table className="mt-2">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Problem</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>File</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.fileHashSubmissions.map((submission) => (
                      <SubmissionRow key={submission.id} submission={submission} />
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No matches found.</p>
              )}
            </div>
            <br />

            <div>
              <h3 className="text-sm font-semibold">Matching Structure Values</h3>
              <p className="text-sm text-muted-foreground">Submissions matched by identical structure values.</p>
              {report?.calcHashSubmissions?.length ? (
                <Table className="mt-2">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Problem</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>File</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.calcHashSubmissions.map((submission) => (
                      <SubmissionRow key={submission.id} submission={submission} />
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No matches found.</p>
              )}
            </div>
          </div>
          <br />
        </div>

        <div className="mt-4 flex justify-end">
          <DialogClose asChild>
            <Button variant="secondary">Close</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
