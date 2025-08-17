'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Clock, Info } from 'lucide-react';
import { useState } from 'react';

interface ActivityUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
}

interface ActivityLog {
  id: string;
  userId: string | null;
  action: string;
  timestamp: string;
  metadata: Record<string, unknown> | null;
  user: ActivityUser | null;
}

// Metadata cell component with expandable metadata
function MetadataCell({ activity }: { activity: ActivityLog }) {
  const [expanded, setExpanded] = useState(false);

  const formatMetadataForDisplay = (metadata: Record<string, unknown> | null) => {
    if (!metadata || Object.keys(metadata).length === 0) return 'No metadata available';
    
    return Object.entries(metadata)
      .map(([key, value]) => {
        if (value === null || value === undefined) {
          return `${key}: null`;
        }
        return `${key}: ${JSON.stringify(value, null, 2)}`;
      })
      .join('\n');
  };

  if (!activity.metadata || Object.keys(activity.metadata).length === 0) {
    return null;
  }

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
          <Info className="h-3 w-3" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="relative z-10">
        <div className="absolute right-0 top-2 w-80 max-w-[90vw] bg-popover border rounded-md shadow-md p-3 max-h-60 overflow-auto">
          <div className="text-xs font-medium mb-2">Metadata</div>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono break-words">
            {formatMetadataForDisplay(activity.metadata)}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Helper functions
const getActionBadgeVariant = (action: string) => {
  if (action.toLowerCase().includes('login')) return 'secondary';
  if (action.toLowerCase().includes('create')) return 'default';
  if (action.toLowerCase().includes('update') || action.toLowerCase().includes('edit')) return 'outline';
  if (action.toLowerCase().includes('delete')) return 'destructive';
  if (action.toLowerCase().includes('submission')) return 'secondary';
  return 'secondary';
};

const formatAction = (action: string) => {
  return action
    .split('_')
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
};

const getInitials = (user: ActivityUser | null) => {
  if (!user) return 'U';
  const first = user.firstName?.charAt(0) || '';
  const last = user.lastName?.charAt(0) || '';
  return first + last || user.email.charAt(0).toUpperCase();
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

const formatFullTimestamp = (timestamp: string) => {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
};

const getIpAddress = (metadata: Record<string, unknown> | null) => {
  if (!metadata) return null;
  
  // Check for ipAddress field first, then fallback to other common keys
  const ipKeys = ['ipAddress', 'ip', 'clientIp', 'remoteAddress'];
  
  for (const key of ipKeys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value === '::1' ? 'localhost' : value;
    }
  }
  
  return null;
};

export const activityColumns: ColumnDef<ActivityLog>[] = [
  {
    id: 'avatar',
    header: '',
    cell: ({ row }) => {
      const activity = row.original;
      return (
        <Avatar className="h-10 w-10">
          <AvatarImage 
            src={activity.user?.avatar ? `/uploads/${activity.user.avatar}` : undefined}
            alt={`${activity.user?.firstName} ${activity.user?.lastName}`}
          />
          <AvatarFallback className="text-xs bg-secondary text-secondary-foreground">
            {getInitials(activity.user)}
          </AvatarFallback>
        </Avatar>
      );
    },
  },
  {
    accessorKey: 'user.firstName',
    header: 'First Name',
    cell: ({ row }) => {
      const activity = row.original;
      return (
        <div className="text-sm">
          {activity.user?.firstName || 'Unknown'}
        </div>
      );
    },
  },
  {
    accessorKey: 'user.lastName',
    header: 'Last Name',
    cell: ({ row }) => {
      const activity = row.original;
      return (
        <div className="text-sm">
          {activity.user?.lastName || 'User'}
        </div>
      );
    },
  },
  {
    accessorKey: 'action',
    header: 'Activity',
    cell: ({ row }) => {
      const activity = row.original;
      return (
        <Badge variant={getActionBadgeVariant(activity.action)} className="text-xs">
          {formatAction(activity.action)}
        </Badge>
      );
    },
  },
  {
    accessorKey: 'timestamp',
    header: 'Time',
    cell: ({ row }) => {
      const activity = row.original;
      return (
        <div className="text-sm">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTimestamp(activity.timestamp)}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {formatFullTimestamp(activity.timestamp)}
          </div>
        </div>
      );
    },
  },
  {
    id: 'ipAddress',
    header: 'IP Address',
    cell: ({ row }) => {
      const activity = row.original;
      const ipAddress = getIpAddress(activity.metadata);
      return (
        <div className="text-xs text-muted-foreground font-mono">
          {ipAddress || '-'}
        </div>
      );
    },
  },
  {
    id: 'metadata',
    header: 'Metadata',
    cell: ({ row }) => <MetadataCell activity={row.original} />,
  },
];
