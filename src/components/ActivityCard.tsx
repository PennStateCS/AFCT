'use client';

import React, { useEffect, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
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
import { apiPaths } from '@/lib/api-paths';

const PAGE_SIZE = 50;

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

  // Memoize columns so a re-render doesn't recreate the array (and its cell
  // components), which would force DataTable and its rows to re-render.
  const columns = useMemo(() => getActivityColumns(timezone), [timezone]);

  // Cached, offset-paginated activity log. Each page (offset) is cached
  // separately; useInfiniteQuery accumulates the pages into one list, preserving
  // the existing "Load More" append behavior while adding caching between visits.
  const {
    data,
    isLoading,
    isError,
    error,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['course', courseId, 'activity', { limit: PAGE_SIZE }],
    queryFn: async ({ pageParam }) => {
      const offset = pageParam as number;
      const url = apiPaths.courseActivity(courseId, { limit: PAGE_SIZE, offset });
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch activities: ${response.status} ${response.statusText}`);
      }
      return (await response.json()) as ActivityResponse;
    },
    initialPageParam: 0,
    // Next offset is the running total of rows loaded so far; undefined when the
    // server reports there is no more data.
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      return allPages.reduce((sum, page) => sum + page.activities.length, 0);
    },
    staleTime: 30_000,
  });

  // Surface fetch failures as a toast, matching the prior UX.
  useEffect(() => {
    if (isError) {
      toast.error(
        `Failed to load activity data: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }, [isError, error]);

  const activities = data?.pages.flatMap((page) => page.activities) ?? [];
  const totalCount = data?.pages[0]?.totalCount ?? 0;
  const hasMore = hasNextPage;

  const loadMore = () => {
    if (!isFetchingNextPage && hasNextPage) {
      void fetchNextPage();
    }
  };

  const refresh = () => {
    void refetch();
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-2xl font-semibold">
          <Activity className="h-5 w-5" />
          Activity
        </h2>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="ml-2">Loading activity...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-row items-center justify-between">
        <h2 className="flex items-center gap-2 text-2xl font-semibold">
          <Activity className="h-5 w-5" />
          Activity
          {totalCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {totalCount}
            </Badge>
          )}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={isFetching}
          aria-label="Refresh activity"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      <div className="overflow-x-auto">
        {activities.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center">
            <Activity className="mx-auto mb-4 h-12 w-12 opacity-50" />
            <p>No activity recorded yet for this course.</p>
          </div>
        ) : (
          <>
            <DataTable columns={columns} data={activities} tableLabel="Activity log table" />

            {hasMore && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMore}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? (
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
      </div>
    </div>
  );
}
