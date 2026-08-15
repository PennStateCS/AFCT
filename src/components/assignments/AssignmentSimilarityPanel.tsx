'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { ChevronDown, Eye, Fingerprint } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ViewSubmissionDialog } from '@/components/dialogs/ViewSubmissionDialog';
import { SubmissionMatchDialog } from '@/components/assignments/SubmissionMatchDialog';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api/fetch-client';
import { getInitials } from '@/app/utils/initials';
import { formatDateInTimeZone, zoneAbbrev, parseValidDate } from '@/lib/date-format';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import type { SubmissionMatchGroup, MatchSubmission } from '@/lib/similarity/matches';

/**
 * Submissions to this assignment that are the same file as somebody else's.
 *
 * Staff-only: rendered inside PrivilegeAssignmentView, which the server renders only for
 * admins and the course's FACULTY/TA.
 *
 * The panel reports, it does not accuse. Every row says how many students share the content
 * against how many submitted the problem, because that ratio is the whole meaning: two of
 * forty is worth reading, twenty-five of forty is what a correct answer looks like. Nothing
 * here is labelled suspicious, and no flag is stored against a student.
 */

/** Past this share of the class, identical work is the answer rather than a finding. */
const COMMON_SHARE = 0.25;

const studentName = (student: MatchSubmission['student']) =>
  `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() || 'Unknown student';

export function AssignmentSimilarityPanel() {
  const { id: courseId, aid: assignmentId } = useParams<{ id: string; aid: string }>();
  const { timezone } = useEffectiveTimezone();

  const [openGroup, setOpenGroup] = useState<SubmissionMatchGroup | null>(null);
  // The problem type travels with the submission being viewed: the viewer needs it to pick
  // a renderer, and the group it came from is closed by then.
  const [viewing, setViewing] = useState<{
    submission: MatchSubmission;
    problemType: string | null;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.assignment.similarity(courseId, assignmentId),
    queryFn: () =>
      apiClient.get<SubmissionMatchGroup[]>(apiPaths.assignmentSimilarity(courseId, assignmentId)),
    enabled: !!courseId && !!assignmentId,
    staleTime: 30_000,
  });

  const formatSubmittedAt = (iso: string) => {
    const date = parseValidDate(iso);
    if (!date) return 'Unknown';
    return `${formatDateInTimeZone(date, timezone)} ${zoneAbbrev(date, timezone)}`;
  };

  const columns = useMemo<ColumnDef<SubmissionMatchGroup, unknown>[]>(
    () => [
      {
        id: 'students',
        header: 'Students',
        accessorFn: (row) => row.submissions.map((s) => studentName(s.student)).join(', '),
        cell: ({ row }) => {
          // One entry per student, not per submission: a student who submitted the same
          // file twice is one person, and listing them twice reads as two people.
          const seen = new Map<string, MatchSubmission>();
          for (const submission of row.original.submissions) {
            if (!seen.has(submission.student.id)) seen.set(submission.student.id, submission);
          }
          const students = [...seen.values()];
          const shown = students.slice(0, 3);

          return (
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                {shown.map((submission) => {
                  const name = studentName(submission.student);
                  return (
                    <Avatar key={submission.student.id} className="border-background h-9 w-9 border-2">
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
                  );
                })}
              </div>
              <div className="min-w-0">
                <div className="font-medium">
                  {shown.map((submission) => studentName(submission.student)).join(', ')}
                  {students.length > shown.length ? ` and ${students.length - shown.length} more` : ''}
                </div>
              </div>
            </div>
          );
        },
        meta: { priority: 1, rowHeader: true, align: 'left' },
      },
      {
        id: 'problem',
        header: 'Problem',
        accessorFn: (row) => row.problem.title ?? 'Unknown problem',
        cell: ({ row }) => row.original.problem.title ?? 'Unknown problem',
        meta: { priority: 2, align: 'left' },
      },
      {
        id: 'shared',
        header: 'Identical work',
        accessorFn: (row) => row.studentCount,
        cell: ({ row }) => {
          const { studentCount, problemStudentCount } = row.original;
          const common =
            problemStudentCount > 0 && studentCount / problemStudentCount >= COMMON_SHARE;
          return (
            <div className="flex items-center gap-2">
              <span>
                {studentCount} of {problemStudentCount} students
              </span>
              {common ? (
                <Badge variant="neutral" title="Shared by much of the class, so probably just the answer">
                  Common
                </Badge>
              ) : null}
            </div>
          );
        },
        meta: { priority: 2, align: 'left' },
      },
      {
        id: 'submittedAt',
        header: 'Latest',
        accessorFn: (row) => row.submissions[0]?.submittedAt ?? '',
        cell: ({ row }) => {
          const latest = row.original.submissions[0]?.submittedAt;
          return latest ? formatSubmittedAt(latest) : '—';
        },
        meta: { priority: 3, align: 'left' },
      },
      {
        id: 'manage',
        header: 'Manage',
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                aria-label={`Manage match ${row.original.matchId}`}
              >
                <ChevronDown />
                Manage
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setOpenGroup(row.original)}
                className="flex items-center gap-2"
              >
                <Eye className="mr-2 h-4 w-4" />
                View these submissions
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
        meta: { priority: 4, align: 'right' },
      },
    ],
    // formatSubmittedAt closes over the timezone, which is the only thing that changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timezone],
  );

  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 text-2xl font-semibold">
        <Fingerprint className="h-6 w-6" />
        Similarity
      </h2>

      <p className="text-muted-foreground max-w-3xl text-sm">
        Submissions to this assignment that are the same file as another student&apos;s, rarest
        first. Identical work is not by itself evidence of anything: on a problem with one
        obvious answer most of the class can submit the same thing. Read the ratio, then read
        the files.
      </p>

      <div className="overflow-x-auto">
        <DataTable
          columns={columns}
          data={data ?? []}
          loading={isLoading}
          tableLabel="Matching submissions table"
          emptyTitle="No matching submissions"
          emptyDescription="No two students have submitted the same file for this assignment's problems."
          emptyIcon={Fingerprint}
          loadingMessage="Looking for matching submissions, please wait..."
        />
      </div>

      <SubmissionMatchDialog
        open={openGroup !== null}
        onOpenChange={(open) => !open && setOpenGroup(null)}
        group={openGroup}
        formatSubmittedAt={formatSubmittedAt}
        onViewSubmission={(submission) => {
          // The viewer replaces the list rather than stacking on top of it: two dialogs deep
          // is somewhere a reader cannot find the way out of.
          setOpenGroup(null);
          setViewing({ submission, problemType: openGroup?.problem.type ?? null });
        }}
      />

      <ViewSubmissionDialog
        open={viewing !== null}
        onOpenChange={(open) => !open && setViewing(null)}
        submission={
          viewing
            ? {
                fileName: viewing.submission.fileName,
                originalFileName: viewing.submission.originalFileName,
                problem: { type: viewing.problemType },
              }
            : null
        }
      />
    </div>
  );
}
