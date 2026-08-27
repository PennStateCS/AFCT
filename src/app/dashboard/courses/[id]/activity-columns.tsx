'use client';

import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CategoryBadge } from '@/components/ui/category-badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ACTIVITY_SEVERITY_BADGE, ACTIVITY_SEVERITY_FALLBACK } from '@/lib/badge-presets';
import {
  actionLabel,
  describeActivity,
  displayIpAddress,
  summaryParts,
  SUMMARY_SEPARATOR,
  type RelatedRecords,
} from '@/lib/activity-log-summary';
import { FileText } from 'lucide-react';
import { formatDateTimeInTimeZone } from '@/lib/date-format';
import { clientDescription } from '@/lib/user-agent';
import { CompactDate } from '@/components/ui/CompactDate';
import { TEXT_LINK_CLASS } from '@/lib/link-styles';

export interface ActivityUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  cropX: number | null;
  cropY: number | null;
  zoom: number | null;
}

export interface ActivityLog {
  id: string;
  userId: string | null;
  action: string;
  timestamp: string;
  metadata: Record<string, unknown> | null;
  user: ActivityUser | null;
  // Enhanced fields (available in new entries with enhanced schema)
  category?: string;
  severity?: string;
  ipAddress?: string;
  userAgent?: string;
  courseId?: string;
  assignmentId?: string;
  problemId?: string;
  submissionId?: string;
  // Enhanced relations (available from API includes)
  course?: {
    id: string;
    name: string;
    code: string;
  } | null;
  assignment?: {
    id: string;
    title: string;
  } | null;
  problem?: {
    id: string;
    title: string;
  } | null;
  submission?: {
    id: string;
    assignmentProblem: {
      assignment: {
        title: string;
      };
    };
  } | null;
}

/**
 * The records an entry points at, named where the relation came back and identified by id
 * where it did not.
 *
 * An older row can carry the foreign key without the relation being included, and an id is
 * worse than a name but far better than silence: it still says the entry was about something.
 * The Subject column and the details dialog both read this, so they cannot drift apart.
 */
export function relatedRecords(activity: ActivityLog): RelatedRecords {
  return {
    course: activity.course
      ? `${activity.course.code}, ${activity.course.name}`
      : (activity.courseId ?? null),
    assignment: activity.assignment?.title ?? activity.assignmentId ?? null,
    problem: activity.problem?.title ?? activity.problemId ?? null,
    // A submission has no name of its own. The assignment it belongs to is the useful part,
    // and the id is what somebody would search for.
    submission:
      activity.submission?.assignmentProblem.assignment.title ?? activity.submissionId ?? null,
  };
}

/** The actor in words, for the sentence the details dialog opens with. */
export function actorName(activity: ActivityLog): string | null {
  const name = [activity.user?.firstName, activity.user?.lastName].filter(Boolean).join(' ').trim();
  return name || activity.user?.email || null;
}

const formatFullTimestamp = (timestamp: string, timeZone: string) =>
  formatDateTimeInTimeZone(timestamp, timeZone);

/**
 * The assignment an entry is about.
 *
 * Relation first, then metadata: older rows recorded only a title, and those still display
 * even though an assignment-id filter cannot match them. Only the assignment-specific
 * metadata keys, never a generic `title`, which on other actions means something else.
 */
const assignmentTitle = (activity: ActivityLog): string =>
  activity.assignment?.title ||
  activity.submission?.assignmentProblem?.assignment?.title ||
  (activity.metadata?.assignmentTitle as string) ||
  (activity.metadata?.assignmentName as string) ||
  '';

/** The problem an entry is about, read the same way. */
const problemTitle = (activity: ActivityLog): string =>
  activity.problem?.title ||
  (activity.metadata?.problemTitle as string) ||
  (activity.metadata?.problemName as string) ||
  '';

const getIpAddress = (metadata: Record<string, unknown> | null, activity: ActivityLog) => {
  // Try the direct ipAddress field first (from enhanced schema)
  if (activity.ipAddress) return displayIpAddress(activity.ipAddress);

  // Fallback to metadata for legacy entries
  if (!metadata) return null;

  const ipKeys = ['ipAddress', 'ip', 'clientIp', 'remoteAddress'];

  for (const key of ipKeys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return displayIpAddress(value);
  }

  return null;
};

/**
 * The course activity table, in the shape System Logs uses.
 *
 * Same columns, same order and the same cells, so a reader who has learned one page has
 * learned the other: one log entry should not look like two different things depending on
 * which screen found it. Assignment and Problem are the one addition, because on a course
 * they are what you are scanning for, where System Logs has to say which course an entry
 * belongs to first.
 */
export const getActivityColumns = (
  timeZone: string,
  courseId: string,
  onViewDetails: (activity: ActivityLog) => void,
): ColumnDef<ActivityLog>[] => [
  {
    accessorKey: 'timestamp',
    meta: { priority: 1 },
    header: 'Time',
    // The same two-line cell System Logs and the Courses table use: the date on top, the time
    // muted underneath, so the column stays narrow instead of forcing one wide
    // "MM/DD/YY HH:MM AM" line. It replaced a relative "5h ago" line, which read well on a
    // feed and badly in an audit trail, where the question is when something happened rather
    // than how long ago.
    cell: ({ getValue }) => <CompactDate value={getValue() as string | null} timeZone={timeZone} />,
  },
  {
    accessorKey: 'severity',
    header: 'Severity',
    meta: { priority: 2 },
    // One width for every badge in the column, so their edges line up and the column reads as
    // a column rather than as chips of four different lengths. See the longer note on the
    // System Logs table: it is a minimum rather than a fixed width because Badge clips.
    cell: ({ row }) => {
      const s = (row.original.severity || 'INFO') as keyof typeof ACTIVITY_SEVERITY_BADGE;
      return (
        <Badge
          variant={ACTIVITY_SEVERITY_BADGE[s] ?? ACTIVITY_SEVERITY_FALLBACK}
          className="min-w-20"
        >
          {s}
        </Badge>
      );
    },
  },
  {
    id: 'category',
    // No filterVariant: the table shows one server-ordered page, so a faceted filter here
    // could only narrow the rows on screen. Category, Assignment and Problem are filtered
    // through the toolbar's Filters menu in ActivityCard instead.
    meta: { priority: 3 },
    header: 'Category',
    enableSorting: true,
    accessorFn: (row) => row.category || '',
    cell: ({ row }) => <CategoryBadge category={row.original.category} className="min-w-24" />,
  },
  {
    // Explicit id: TanStack would otherwise derive `user_lastName` from the dotted
    // accessorKey, which is not what the server's sort allow-list is keyed by.
    //
    // One column rather than the two it replaced: on a log you scan for a person, and a
    // surname split from its given name across two columns is two things to read for one
    // answer. Keyed on the last name, which is both what it sorts by and what it leads with.
    id: 'userLastName',
    accessorKey: 'user.lastName',
    header: 'User',
    meta: { priority: 2 },
    cell: ({ row }) => {
      const user = row.original.user;
      const last = user?.lastName?.trim();
      const first = user?.firstName?.trim();
      const email = user?.email?.trim();
      // userId is nullable and the relation is SetNull, so a row can outlive its author.
      if (!last && !first) return email ? <div className="text-sm">{email}</div> : '—';
      // Two lines, the same shape the Time column uses: the name to read, the address
      // underneath in the muted size to tell two people of the same name apart. The name is
      // upper-cased in CSS rather than transformed, so what a screen reader announces stays in
      // ordinary case; the address is not, because it is a value somebody may copy.
      return (
        <div className="text-sm leading-tight uppercase">
          <div className="uppercase">{[last, first].filter(Boolean).join(', ')}</div>
          {email ? <div className="text-muted-foreground text-xs">{email}</div> : null}
        </div>
      );
    },
  },
  {
    accessorKey: 'action',
    header: 'Action',
    meta: { priority: 1 },
    // The verb, from the shared formatter. The cell shows "Graded"; sorting, search and
    // filters still use the stored GRADE_UPDATED. Upper-cased in CSS for the reason given on
    // the User column above.
    cell: ({ row }) => {
      const activity = row.original;
      return (
        <div className="text-sm uppercase">
          {actionLabel(activity.action, activity.metadata as Record<string, unknown> | null)}
        </div>
      );
    },
  },
  {
    id: 'summary',
    header: 'Subject',
    meta: { priority: 2 },
    enableSorting: false,
    // What the entry was about, in the words System Logs uses. The separator between the
    // object and what happened to it is punctuation between two facts, so it is hidden from
    // assistive tech: read aloud it is "middle dot" in the middle of a sentence.
    cell: ({ row }) => {
      const activity = row.original;
      const parts = summaryParts(
        describeActivity(
          activity.action,
          activity.metadata as Record<string, unknown> | null,
          relatedRecords(activity),
        ),
      );
      if (parts.length === 0) return <span className="text-sm uppercase">—</span>;
      return (
        <span className="text-sm uppercase">
          {parts.map((part, i) => (
            <span key={i}>
              {i > 0 ? <span aria-hidden="true">{SUMMARY_SEPARATOR}</span> : null}
              {part}
            </span>
          ))}
        </span>
      );
    },
  },
  {
    // One column, two lines: the assignment on top and the problem under it, the way User
    // carries a name over an address. They were two columns of mostly-empty cells side by
    // side, and a course log is read as "which piece of work", not as two separate answers.
    id: 'assignmentProblem',
    meta: { priority: 2 },
    header: 'Assignment / Problem',
    // Not sortable: the displayed titles come from relations with metadata fallbacks, so
    // there is no single column the server can order the whole log by. Filter by them
    // instead, which the toolbar's Filters menu still offers separately.
    enableSorting: false,
    accessorFn: (row) => [assignmentTitle(row), problemTitle(row)].filter(Boolean).join(' '),
    cell: ({ row }) => {
      const activity = row.original;
      const assignment = assignmentTitle(activity);
      const problem = problemTitle(activity);
      if (!assignment && !problem) return <div className="text-sm">—</div>;
      // Linked only where the entry recorded an id. An older row can carry a title in its
      // metadata and nothing else, and a link that guesses at which record it meant is worse
      // than plain text on an audit trail.
      const assignmentId = activity.assignment?.id ?? activity.assignmentId;
      const problemId = activity.problem?.id ?? activity.problemId;
      // Upper-cased in CSS rather than transformed, like Action, Subject and the name in
      // User: what a screen reader announces and what Copy JSON carries stay in ordinary
      // case. Both lines, unlike User, because a title is read rather than copied.
      return (
        <div className="text-sm leading-tight uppercase">
          <div>
            {assignment && assignmentId ? (
              <Link
                className={TEXT_LINK_CLASS}
                href={`/dashboard/courses/${courseId}/${assignmentId}`}
              >
                {assignment}
              </Link>
            ) : (
              assignment || '—'
            )}
          </div>
          {problem ? (
            <div className="text-muted-foreground text-xs">
              {problemId ? (
                // Problems have no page of their own: they live in the course's Problems tab
                // and open from there, so this is as close as a link can get.
                <Link
                  className={TEXT_LINK_CLASS}
                  href={`/dashboard/courses/${courseId}?tab=problems`}
                >
                  {problem}
                </Link>
              ) : (
                problem
              )}
            </div>
          ) : null}
        </div>
      );
    },
  },
  {
    id: 'ipAddress',
    meta: { priority: 4 },
    header: 'IP Address',
    enableSorting: true,
    accessorFn: (row) => getIpAddress(row.metadata, row) || '',
    // Two lines, the shape the Time and User columns use: the address, and under it the
    // browser and platform the request came from. An address on its own rarely settles "was
    // that really them"; the same address from a phone rather than the lab machine often does.
    // The whole header is still in the details dialog.
    cell: ({ row }) => {
      const activity = row.original;
      const ip = getIpAddress(activity.metadata, activity);
      const client = clientDescription(activity.userAgent);
      if (!ip && !client) return '—';
      return (
        <div className="leading-tight">
          <div>{ip ?? '—'}</div>
          {client ? <div className="text-muted-foreground text-xs">{client}</div> : null}
        </div>
      );
    },
  },
  {
    // `actions`, not a name of its own: that id is what the shared mobile card view looks for
    // to put a row's action in the card's corner. Named anything else it would stay a labelled
    // field in the card's body.
    id: 'actions',
    header: 'Details',
    meta: { priority: 1, align: 'center' as const },
    enableSorting: false,
    // The same dialog System Logs opens, in place of the popover this used to hover open. The
    // popover held the same text in a 20rem box that closed when you clicked to select it.
    cell: ({ row }) => {
      const activity = row.original;
      const when = activity.timestamp ? formatFullTimestamp(activity.timestamp, timeZone) : null;
      const what = actionLabel(
        activity.action,
        activity.metadata as Record<string, unknown> | null,
      );
      // Every row carries one of these, so the name says WHICH entry: a page of buttons all
      // called "View details" is what a screen reader would otherwise read out.
      const label = when ? `View full log for ${what} at ${when}` : `View full log for ${what}`;
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              onClick={() => onViewDetails(activity)}
            >
              <FileText className="size-5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>View full log</TooltipContent>
        </Tooltip>
      );
    },
  },
];
