'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { Fingerprint, Columns2 } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Spinner from '@/components/ui/spinner';
import { CompareSubmissionsDialog } from '@/components/assignments/CompareSubmissionsDialog';
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
 * Cards rather than a table, and grouped under their problem, because there are usually
 * none to three of these and the reader's question is "is there anything here", not "sort
 * this by column". The panel reports and never accuses: every card says how many students
 * share the content against how many submitted the problem, nothing is labelled suspicious,
 * and no flag is stored against a student.
 */

/** Past this share of a problem's students, identical work is the answer, not a finding. */
const COMMON_SHARE = 0.25;

const studentName = (student: MatchSubmission['student']) =>
  `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() || 'Unknown student';

const isCommon = (group: SubmissionMatchGroup) =>
  group.problemStudentCount > 0 && group.studentCount / group.problemStudentCount >= COMMON_SHARE;

/** One entry per student: a student who submitted the same file twice is one person. */
function distinctStudents(group: SubmissionMatchGroup): MatchSubmission[] {
  const seen = new Map<string, MatchSubmission>();
  for (const submission of group.submissions) {
    if (!seen.has(submission.student.id)) seen.set(submission.student.id, submission);
  }
  return [...seen.values()];
}

/** "6 minutes apart", "2 days apart". Null when there is nothing to say. */
function gapLabel(ms: number | null): string | null {
  if (ms === null) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'less than a minute apart';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} apart`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} apart`;
  return `${Math.round(hours / 24)} days apart`;
}

/** The line that answers "do I need to read any of this". */
function summarise(groups: SubmissionMatchGroup[]): string {
  if (groups.length === 0) return 'No two students submitted the same file.';
  const problems = new Set(groups.map((group) => group.problem.id)).size;
  const common = groups.filter(isCommon).length;
  const sets = `${groups.length} set${groups.length === 1 ? '' : 's'} of identical work`;
  const across = `across ${problems} problem${problems === 1 ? '' : 's'}`;
  if (common === 0) return `${sets} ${across}.`;
  if (common === groups.length) return `${sets} ${across}, all of it shared by much of the class.`;
  return `${sets} ${across}, ${common} of them shared by much of the class.`;
}

export function AssignmentSimilarityPanel() {
  const { id: courseId, aid: assignmentId } = useParams<{ id: string; aid: string }>();
  const { timezone } = useEffectiveTimezone();
  const [comparing, setComparing] = useState<{
    submissions: MatchSubmission[];
    problemType: string | null;
    problemTitle: string | null;
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

  // Grouped under their problem, and a problem whose rarest match is rarer comes first, so
  // the one worth reading is at the top and "everybody wrote this" sinks.
  const byProblem = useMemo(() => {
    const sections = new Map<string, { title: string | null; matches: SubmissionMatchGroup[] }>();
    for (const group of data ?? []) {
      const section = sections.get(group.problem.id) ?? { title: group.problem.title, matches: [] };
      section.matches.push(group);
      sections.set(group.problem.id, section);
    }
    return [...sections.entries()].sort(
      ([, a], [, b]) => (a.matches[0]?.studentCount ?? 0) - (b.matches[0]?.studentCount ?? 0),
    );
  }, [data]);

  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 text-2xl font-semibold">
        <Fingerprint className="h-6 w-6" />
        Similarity
      </h2>

      {/* One live region for the panel's state, so a screen reader hears the answer once
          rather than a card at a time. */}
      <div aria-live="polite" className="max-w-3xl space-y-2">
        {isLoading ? (
          <div className="flex items-center gap-3 text-sm">
            <Spinner />
            <span>Looking for matching submissions...</span>
          </div>
        ) : (
          <p className="text-base font-medium">{summarise(data ?? [])}</p>
        )}
        <p className="text-muted-foreground text-sm">
          Identical work is not by itself evidence of anything: a problem with one obvious
          answer will have students submitting the same thing honestly, and a grammar or
          regular expression has no layout to differ in. Read the numbers, then read the files.
        </p>
      </div>

      {byProblem.map(([problemId, section]) => (
        <section key={problemId} className="max-w-3xl space-y-2">
          <h3 className="text-lg font-semibold">{section.title ?? 'Unknown problem'}</h3>

          {section.matches.map((group) => {
            const students = distinctStudents(group);
            const common = isCommon(group);
            const gap = gapLabel(group.closestGapMs);

            return (
              <div key={group.matchId} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span>
                      {group.studentCount} of {group.problemStudentCount} students submitted
                      identical work
                    </span>
                    {common ? (
                      <Badge variant="neutral" title="Shared by much of the class">
                        Common
                      </Badge>
                    ) : null}
                  </div>
                  {gap ? <span className="text-muted-foreground text-sm">{gap}</span> : null}
                </div>

                {common ? (
                  <p className="text-muted-foreground text-sm">
                    Most of the class submitted this same work, so it is probably just the
                    answer.
                  </p>
                ) : null}

                <ul className="space-y-2">
                  {students.map((submission) => (
                    <li key={submission.id} className="flex flex-wrap items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarImage
                          src={
                            submission.student.avatar
                              ? apiPaths.files.pfp(submission.student.avatar)
                              : undefined
                          }
                          alt={studentName(submission.student)}
                          cropX={submission.student.cropX ?? 0.5}
                          cropY={submission.student.cropY ?? 0.5}
                          zoom={submission.student.zoom ?? 1}
                        />
                        <AvatarFallback>
                          {getInitials(
                            submission.student.firstName,
                            submission.student.lastName,
                            undefined,
                          )}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{studentName(submission.student)}</div>
                        <div className="text-muted-foreground text-xs">
                          {formatSubmittedAt(submission.submittedAt)}
                          {submission.studentGroup
                            ? ` · Group: ${submission.studentGroup.name}`
                            : ''}
                        </div>
                      </div>
                      {submission.fileName ? (
                        <a
                          className="text-sm underline"
                          href={apiPaths.files.submission(encodeURIComponent(submission.fileName), {
                            download: true,
                          })}
                          download={submission.originalFileName ?? 'submission'}
                        >
                          {submission.originalFileName ?? submission.fileName}
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-sm">No file</span>
                      )}
                    </li>
                  ))}
                </ul>

                {students.length >= 2 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      // The whole match goes to the dialog, not a pair chosen here: it opens
                      // on the two closest together in time and lets either side be swapped
                      // to anyone else in the match.
                      setComparing({
                        submissions: students,
                        problemType: group.problem.type,
                        problemTitle: group.problem.title,
                      })
                    }
                  >
                    <Columns2 />
                    Compare files
                  </Button>
                ) : null}
              </div>
            );
          })}
        </section>
      ))}

      <CompareSubmissionsDialog
        open={comparing !== null}
        onOpenChange={(open) => !open && setComparing(null)}
        submissions={comparing?.submissions ?? null}
        problemType={comparing?.problemType ?? null}
        problemTitle={comparing?.problemTitle ?? null}
        formatSubmittedAt={formatSubmittedAt}
      />
    </div>
  );
}
