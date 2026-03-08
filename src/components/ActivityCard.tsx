'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import {
  getActivityColumns,
  type ActivityLog,
} from '@/app/dashboard/courses/[id]/activity-columns';
import { Loader2, RefreshCw, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';

interface ActivityResponse {
  activities: ActivityLog[];
  totalCount: number;
  hasMore: boolean;
}

interface ActivityCardProps {
  courseId: string;
}

export function ActivityCard({ courseId }: ActivityCardProps) {
  const { timezone } = useEffectiveTimezone();
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const fetchActivities = useCallback(
    async (offset = 0, append = false) => {
      try {
        if (offset === 0) setLoading(true);
        else setLoadingMore(true);

        const url = `/api/courses/${courseId}/activity?limit=50&offset=${offset}`;

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Failed to fetch activities: ${response.status} ${response.statusText}`);
        }

        const data: ActivityResponse = await response.json();

        if (append) {
          setActivities((prev) => [...prev, ...data.activities]);
        } else {
          setActivities(data.activities);
        }

        setHasMore(data.hasMore);
        setTotalCount(data.totalCount);
      } catch (error) {
        toast.error(
          `Failed to load activity data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [courseId],
  );

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);
  <DataTable
    columns={getActivityColumns(timezone)}
    data={activities}
    tableLabel="Activity log table"
  />;
  const loadMore = () => {
    if (!loadingMore && hasMore) {
      fetchActivities(activities.length, true);
    }
  };

  const refresh = () => {
    fetchActivities();
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Activity className="h-5 w-5" />
            Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2">Loading activity...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="flex items-center gap-2 text-2xl">
          <Activity className="h-5 w-5" />
          Activity
          {totalCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {totalCount}
            </Badge>
          )}
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={loading}
          aria-label="Refresh activity"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {activities.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center">
            <Activity className="mx-auto mb-4 h-12 w-12 opacity-50" />
            <p>No activity recorded yet for this course.</p>
          </div>
        ) : (
          <>
            <DataTable
              columns={getActivityColumns(timezone)}
              data={activities}
              tableLabel="Activity log table"
            />

            {hasMore && (
              <div className="flex justify-center pt-4">
                <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    'Load More'
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
