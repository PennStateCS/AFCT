'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { getInitials } from '@/app/utils/initials';
import { CategoryBadge } from '@/components/ui/category-badge';
import { Clock, Info } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { formatDateTimeInTimeZone } from '@/lib/date-format';
import { apiPaths } from '@/lib/api-paths';
import { formatActivityDetails } from '@/lib/activity-log-summary';

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

// Metadata cell component with expandable metadata
function MetadataCell({ activity }: { activity: ActivityLog }) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close metadata when clicking outside
  useEffect(() => {
    if (!expanded) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [expanded]);

  /**
   * The same rendering the System Logs dialog uses.
   *
   * This built its own blob before, with raw keys: "Enhanced Fields", "Course ID: cmr7x2...",
   * and metadata printed as `key: value` straight off the object. Two renderers of the same
   * data, and the one somebody looking at a course saw was the worse of them. The shared
   * formatter names the records the entry points at, so the ids go.
   *
   * The timestamp is deliberately not passed: the row it hangs off already shows it, twice.
   */
  const details = formatActivityDetails({
    action: activity.action,
    category: activity.category ?? null,
    ipAddress: activity.ipAddress ?? null,
    userAgent: activity.userAgent ?? null,
    metadata: activity.metadata,
    // Name where there is one, id where there is not. An older row can carry the foreign key
    // without the relation being included, and an id is worse than a name but far better than
    // silence: it still says the entry was about something.
    related: {
      course: activity.course
        ? `${activity.course.code}, ${activity.course.name}`
        : (activity.courseId ?? null),
      assignment: activity.assignment?.title ?? activity.assignmentId ?? null,
      problem: activity.problem?.title ?? activity.problemId ?? null,
      // A submission has no name of its own. The assignment it belongs to is the useful part,
      // and the id is what somebody would search for.
      submission:
        activity.submission?.assignmentProblem.assignment.title ?? activity.submissionId ?? null,
    },
  });

  // Show metadata button if there's metadata OR enhanced field data
  const hasMetadataOrEnhancedData =
    (activity.metadata && Object.keys(activity.metadata).length > 0) ||
    activity.courseId ||
    activity.assignmentId ||
    activity.problemId ||
    activity.submissionId ||
    activity.category ||
    activity.ipAddress ||
    activity.course ||
    activity.assignment ||
    activity.problem ||
    activity.submission;

  if (!hasMetadataOrEnhancedData) {
    return null;
  }

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild>
        {/* Icon-only trigger: name it for assistive tech and reflect its open state. */}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          aria-label={expanded ? 'Hide activity details' : 'Show activity details'}
          aria-expanded={expanded}
        >
          <Info className="h-4 w-4" aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="relative z-10">
        {/* Focusable: the details are a <pre> with nothing tabbable in it, so a keyboard
            user could open this panel and not reach past the first few lines. */}
        <div
          ref={containerRef}
          className="bg-popover absolute top-2 right-0 max-h-60 w-80 max-w-[90vw] overflow-auto rounded-md border p-3 shadow-md"
          tabIndex={0}
          role="group"
          aria-label="Activity details"
        >
          <div className="mb-2 text-xs font-medium">Activity details</div>
          <pre className="text-muted-foreground font-mono text-xs break-words whitespace-pre-wrap">
            {details}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Helper functions
const formatAction = (action: string) => {
  const formattedAction = action
    .split('_')
    .map((word: string) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');

  // Clean formatting without category prefix
  return formattedAction;
};

const formatTimestamp = (timestamp: string) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

  // Relative time for quick reference
  let relativeTime = '';
  if (diffInHours < 1) {
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    relativeTime = diffInMinutes < 1 ? 'Just now' : `${diffInMinutes}m ago`;
  } else if (diffInHours < 24) {
    relativeTime = `${Math.floor(diffInHours)}h ago`;
  } else if (diffInHours < 24 * 7) {
    relativeTime = `${Math.floor(diffInHours / 24)}d ago`;
  } else {
    relativeTime = `${Math.floor(diffInHours / (24 * 7))}w ago`;
  }

  return relativeTime;
};

const formatFullTimestamp = (timestamp: string, timeZone: string) =>
  formatDateTimeInTimeZone(timestamp, timeZone);

const getIpAddress = (metadata: Record<string, unknown> | null, activity: ActivityLog) => {
  // Try the direct ipAddress field first (from enhanced schema)
  if (activity.ipAddress) {
    return activity.ipAddress === '::1' ? 'localhost' : activity.ipAddress;
  }

  // Fallback to metadata for legacy entries
  if (!metadata) return null;

  const ipKeys = ['ipAddress', 'ip', 'clientIp', 'remoteAddress'];

  for (const key of ipKeys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value === '::1' ? 'localhost' : value;
    }
  }

  return null;
};

export const getActivityColumns = (timeZone: string): ColumnDef<ActivityLog>[] => [
  {
    id: 'avatar',
    header: '',
    meta: { priority: 4 },
    cell: ({ row }) => {
      const activity = row.original;
      return (
        <Avatar className="h-10 w-10">
          <AvatarImage
            src={activity.user?.avatar ? apiPaths.files.pfp(activity.user.avatar) : undefined}
            alt={`${activity.user?.firstName} ${activity.user?.lastName}`}
            cropX={activity.user?.cropX ?? 0.5}
            cropY={activity.user?.cropY ?? 0.5}
            zoom={activity.user?.zoom ?? 1}
          />
          <AvatarFallback className="text-xs">
            {getInitials(activity.user?.firstName, activity.user?.lastName, activity.user?.email)}
          </AvatarFallback>
        </Avatar>
      );
    },
  },
  {
    // Explicit id: TanStack would otherwise derive `user_firstName` from the dotted
    // accessorKey, which is not what the server's sort allow-list is keyed by.
    id: 'userFirstName',
    accessorKey: 'user.firstName',
    header: 'First Name',
    meta: { priority: 2 },
    cell: ({ row }) => {
      const activity = row.original;
      return <div className="text-sm">{activity.user?.firstName || 'Unknown'}</div>;
    },
  },
  {
    id: 'userLastName',
    accessorKey: 'user.lastName',
    header: 'Last Name',
    meta: { priority: 3 },
    cell: ({ row }) => {
      const activity = row.original;
      return <div className="text-sm">{activity.user?.lastName || 'User'}</div>;
    },
  },
  {
    accessorKey: 'action',
    header: 'Activity',
    meta: { priority: 1 },
    cell: ({ row }) => {
      const activity = row.original;

      return <div className="text-sm">{formatAction(activity.action)}</div>;
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
    cell: ({ row }) => <CategoryBadge category={row.original.category} />,
  },
  {
    id: 'assignment',
    meta: { priority: 2 },
    header: 'Assignment',
    // Not sortable: the displayed title comes from a relation with metadata fallbacks, so
    // there is no single column the server can order the whole log by. Filter by it instead.
    enableSorting: false,
    accessorFn: (row) => {
      const assignmentTitle =
        row.assignment?.title ||
        row.submission?.assignmentProblem?.assignment?.title ||
        (row.metadata?.assignmentTitle as string) ||
        (row.metadata?.assignmentName as string);
      return assignmentTitle || '';
    },
    cell: ({ row }) => {
      const activity = row.original;
      // Use relation data first (from enhanced schema), then fall back to metadata
      // Only use specific assignment-related metadata fields, not generic 'title'
      const assignmentTitle =
        activity.assignment?.title ||
        activity.submission?.assignmentProblem?.assignment?.title ||
        (activity.metadata?.assignmentTitle as string) ||
        (activity.metadata?.assignmentName as string);

      return (
        <div className="text-sm">
          {assignmentTitle ? (
            <span className="font-medium text-purple-700 dark:text-purple-300">
              {assignmentTitle}
            </span>
          ) : (
            <span className="text-muted-foreground italic">N/A</span>
          )}
        </div>
      );
    },
  },
  {
    id: 'problem',
    meta: { priority: 3 },
    header: 'Problem',
    // Not sortable, for the same reason as Assignment above.
    enableSorting: false,
    accessorFn: (row) => {
      const problemTitle =
        row.problem?.title ||
        (row.metadata?.problemTitle as string) ||
        (row.metadata?.problemName as string);
      return problemTitle || '';
    },
    cell: ({ row }) => {
      const activity = row.original;
      // Use relation data first (from enhanced schema), then fall back to metadata
      const problemTitle =
        activity.problem?.title ||
        (activity.metadata?.problemTitle as string) ||
        (activity.metadata?.problemName as string);

      return (
        <div className="text-sm">
          {problemTitle ? (
            <span className="font-medium text-green-700 dark:text-green-400">{problemTitle}</span>
          ) : (
            <span className="text-muted-foreground italic">N/A</span>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: 'timestamp',
    meta: { priority: 1 },
    header: 'Time',
    cell: ({ row }) => {
      const activity = row.original;
      return (
        <div className="text-sm">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTimestamp(activity.timestamp)}
          </div>
          <div className="text-muted-foreground mt-0.5 text-xs">
            {formatFullTimestamp(activity.timestamp, timeZone)}
          </div>
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
    cell: ({ row }) => {
      const activity = row.original;
      const ipAddress = getIpAddress(activity.metadata, activity);
      return <div className="text-muted-foreground font-mono text-xs">{ipAddress || '-'}</div>;
    },
  },
  {
    id: 'metadata',
    meta: { priority: 4 },
    header: 'Metadata',
    cell: ({ row }) => <MetadataCell activity={row.original} />,
  },
];
