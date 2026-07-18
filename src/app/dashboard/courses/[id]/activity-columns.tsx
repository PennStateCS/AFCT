'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { getInitials } from '@/app/utils/initials';
import { CategoryBadge } from '@/components/ui/category-badge';
import { Clock, Info } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { formatDateTimeInTimeZone } from '@/lib/date';
import { apiPaths } from '@/lib/api-paths';

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

  const formatMetadataForDisplay = (
    metadata: Record<string, unknown> | null,
    activity: ActivityLog,
  ) => {
    if (!metadata || Object.keys(metadata).length === 0) {
      // Even if metadata is empty, show enhanced field information if available
      const enhancedInfo: string[] = [];
      if (activity.courseId) enhancedInfo.push(`Course ID: ${activity.courseId}`);
      if (activity.assignmentId) enhancedInfo.push(`Assignment ID: ${activity.assignmentId}`);
      if (activity.problemId) enhancedInfo.push(`Problem ID: ${activity.problemId}`);
      if (activity.submissionId) enhancedInfo.push(`Submission ID: ${activity.submissionId}`);
      if (activity.category) enhancedInfo.push(`Category: ${activity.category}`);
      if (activity.ipAddress) enhancedInfo.push(`IP Address: ${activity.ipAddress}`);

      return enhancedInfo.length > 0 ? enhancedInfo.join('\n') : 'No metadata available';
    }

    // Group related information for better display
    const sections: string[] = [];

    // Enhanced entity information section
    const entityInfo: string[] = [];
    if (activity.course)
      entityInfo.push(`Course: ${activity.course.name} (${activity.course.code})`);
    if (activity.assignment) entityInfo.push(`Assignment: ${activity.assignment.title}`);
    if (activity.problem) entityInfo.push(`Problem: ${activity.problem.title}`);
    if (activity.submission)
      entityInfo.push(`Assignment: ${activity.submission.assignmentProblem.assignment.title}`);

    if (entityInfo.length > 0) {
      sections.push('Related Entities:\n' + entityInfo.join('\n'));
    }

    // Enhanced fields section
    const enhancedFields: string[] = [];
    if (activity.courseId) enhancedFields.push(`Course ID: ${activity.courseId}`);
    if (activity.assignmentId) enhancedFields.push(`Assignment ID: ${activity.assignmentId}`);
    if (activity.problemId) enhancedFields.push(`Problem ID: ${activity.problemId}`);
    if (activity.submissionId) enhancedFields.push(`Submission ID: ${activity.submissionId}`);
    if (activity.category) enhancedFields.push(`Category: ${activity.category}`);
    if (activity.ipAddress) enhancedFields.push(`IP Address: ${activity.ipAddress}`);
    if (activity.userAgent)
      enhancedFields.push(`User Agent: ${activity.userAgent.substring(0, 50)}...`);

    if (enhancedFields.length > 0) {
      sections.push('Enhanced Fields:\n' + enhancedFields.join('\n'));
    }

    // Metadata section
    const metadataEntries = Object.entries(metadata)
      .filter(([key]) => !['ipAddress', 'userAgent'].includes(key)) // Exclude duplicates
      .map(([key, value]) => {
        if (value === null || value === undefined) {
          return `${key}: null`;
        }
        if (typeof value === 'object') {
          return `${key}: ${JSON.stringify(value, null, 2)}`;
        }
        return `${key}: ${value}`;
      });

    if (metadataEntries.length > 0) {
      sections.push('Metadata:\n' + metadataEntries.join('\n'));
    }

    return sections.join('\n\n') || 'No additional information available';
  };

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
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <Info className="h-4 w-4" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="relative z-10">
        <div
          ref={containerRef}
          className="bg-popover absolute top-2 right-0 max-h-60 w-80 max-w-[90vw] overflow-auto rounded-md border p-3 shadow-md"
        >
          <div className="mb-2 text-xs font-medium">Metadata</div>
          <pre className="text-muted-foreground font-mono text-xs break-words whitespace-pre-wrap">
            {formatMetadataForDisplay(activity.metadata, activity)}
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
          <AvatarFallback className="bg-secondary text-secondary-foreground text-xs">
            {getInitials(activity.user?.firstName, activity.user?.lastName, activity.user?.email)}
          </AvatarFallback>
        </Avatar>
      );
    },
  },
  {
    accessorKey: 'user.firstName',
    header: 'First Name',
    meta: { priority: 2 },
    cell: ({ row }) => {
      const activity = row.original;
      return <div className="text-sm">{activity.user?.firstName || 'Unknown'}</div>;
    },
  },
  {
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
    meta: { priority: 3, filterVariant: 'multiselect', filterLabel: 'Category' },
    header: 'Category',
    enableSorting: true,
    accessorFn: (row) => row.category || '',
    cell: ({ row }) => <CategoryBadge category={row.original.category} />,
  },
  {
    id: 'assignment',
    meta: { priority: 2, filterVariant: 'multiselect', filterLabel: 'Assignment' },
    header: 'Assignment',
    enableSorting: true,
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
            <span className="font-medium text-purple-700">{assignmentTitle}</span>
          ) : (
            <span className="text-muted-foreground italic">N/A</span>
          )}
        </div>
      );
    },
  },
  {
    id: 'problem',
    meta: { priority: 3, filterVariant: 'multiselect', filterLabel: 'Problem' },
    header: 'Problem',
    enableSorting: true,
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
            <span className="font-medium text-green-700">{problemTitle}</span>
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
