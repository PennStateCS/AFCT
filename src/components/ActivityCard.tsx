'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { OnChangeFn, PaginationState, SortingState } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { DataTableFilterMenu } from '@/components/ui/data-table-faceted-filter';
import {
  getActivityColumns,
  type ActivityLog,
} from '@/app/dashboard/courses/[id]/activity-columns';
import { RefreshCw, Activity } from 'lucide-react';
import { showToast } from '@/lib/toast';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { LOG_CATEGORIES } from '@/lib/activity-log-values';

const DEFAULT_PAGE_SIZE = 50;

// Search scope (server-side): restrict the text search to one field.
const SEARCH_FIELDS = [
  { value: 'all', label: 'All fields' },
  { value: 'action', label: 'Activity' },
  { value: 'category', label: 'Category' },
  { value: 'user', label: 'Person' },
];

const EMPTY_ROWS: ActivityLog[] = [];

interface ActivityPage {
  rows: ActivityLog[];
  total: number;
}

interface FilterOptions {
  assignments: { id: string; title: string }[];
  problems: { id: string; title: string }[];
}

interface ActivityCardProps {
  courseId: string;
}

/**
 * The course audit trail, one page at a time.
 *
 * Search, filters and sort all run in the database. They used to run in the browser over
 * whatever "Load More" had fetched, so searching for a real event that had not been loaded
 * yet came back empty, and the filter menus only offered values already on screen. On an
 * audit trail that is worse than slow.
 */
export function ActivityCard({ courseId }: ActivityCardProps) {
  const { timezone } = useEffectiveTimezone();

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // searchInput is what the user is typing; search is the committed (debounced) query.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [categories, setCategories] = useState<string[]>([]);
  const [assignmentIds, setAssignmentIds] = useState<string[]>([]);
  const [problemIds, setProblemIds] = useState<string[]>([]);
  // Newest first: an audit trail is read from the most recent event down.
  const [sorting, setSorting] = useState<SortingState>([{ id: 'timestamp', desc: true }]);

  // Memoize columns so a re-render doesn't recreate the array (and its cell
  // components), which would force DataTable and its rows to re-render.
  const columns = useMemo(() => getActivityColumns(timezone), [timezone]);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPageIndex(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // The course's assignments and problems, so the filter menus can offer every one of them
  // rather than only those appearing in the rows on screen.
  const { data: filterOptions } = useQuery({
    queryKey: queryKeys.course.activityFilters(courseId),
    queryFn: async () => {
      const res = await fetch(apiPaths.courseActivityFilters(courseId));
      if (!res.ok) throw new Error('Failed to load activity filters');
      return (await res.json()) as FilterOptions;
    },
    staleTime: 30_000,
  });

  const sort = sorting[0];
  // One serializable object, used as both the react-query key and the request.
  const params = {
    page: pageIndex + 1,
    pageSize,
    q: search || undefined,
    field: searchField,
    category: categories,
    assignmentId: assignmentIds,
    problemId: problemIds,
    sortBy: sort?.id,
    sortDir: sort?.desc === false ? 'asc' : 'desc',
  };

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: queryKeys.course.activityPage(courseId, params),
    queryFn: async () => {
      const res = await fetch(apiPaths.courseActivity(courseId, params), { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Failed to fetch activities: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as ActivityPage;
    },
    // Holds the current page on screen while the next one loads.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  // Surface fetch failures as a toast, matching the prior UX.
  useEffect(() => {
    if (isError) {
      showToast.error(
        `Failed to load activity data: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }, [isError, error]);

  const rows = data?.rows ?? EMPTY_ROWS;
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const handlePaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = typeof updater === 'function' ? updater({ pageIndex, pageSize }) : updater;
    setPageIndex(next.pageIndex);
    setPageSize(next.pageSize);
  };

  // Sorting is server-side; changing it resets to the first page.
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    setSorting(next);
    setPageIndex(0);
  };

  // A filter change resets to the first page (the result set shifts under you).
  const onFilter = (setter: (v: string[]) => void) => (v: string[]) => {
    setter(v);
    setPageIndex(0);
  };

  const anyFilterActive =
    categories.length > 0 ||
    assignmentIds.length > 0 ||
    problemIds.length > 0 ||
    searchInput.length > 0;

  const refresh = () => {
    void refetch();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-row items-center justify-between">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Activity className="h-5 w-5" />
          Activity
          {total > 0 && (
            <Badge variant="secondary" className="ml-2">
              {total}
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
        <DataTable
          columns={columns}
          data={rows}
          loading={isLoading}
          tableLabel="Activity log table"
          // Its own entry: without a key it shared the default one with every other unnamed
          // table, so hiding a column here hid it on unrelated pages.
          storageKey="course-activity-columns-v1"
          // The browser holds one page, so an export from here would silently write that
          // page and call it the audit trail.
          showExportButton={false}
          loadingMessage="Loading activity, please wait..."
          emptyTitle={anyFilterActive ? 'No activity matches your filters' : 'No activity yet'}
          emptyDescription={
            anyFilterActive
              ? 'Try clearing the search, category, assignment, or problem filter.'
              : 'Course actions like enrollments, submissions and grade changes will appear here.'
          }
          emptyIcon={Activity}
          actionButtons={
            <DataTableFilterMenu
              groups={[
                {
                  key: 'category',
                  label: 'Category',
                  options: LOG_CATEGORIES.map((c) => ({
                    label: c.charAt(0) + c.slice(1).toLowerCase(),
                    value: c,
                  })),
                  selected: categories,
                  onChange: onFilter(setCategories),
                },
                {
                  key: 'assignment',
                  label: 'Assignment',
                  options: (filterOptions?.assignments ?? []).map((a) => ({
                    label: a.title,
                    value: a.id,
                  })),
                  selected: assignmentIds,
                  onChange: onFilter(setAssignmentIds),
                },
                {
                  key: 'problem',
                  label: 'Problem',
                  options: (filterOptions?.problems ?? []).map((p) => ({
                    label: p.title,
                    value: p.id,
                  })),
                  selected: problemIds,
                  onChange: onFilter(setProblemIds),
                },
              ]}
            />
          }
          manualPagination
          pageCount={pageCount}
          rowCount={total}
          pagination={{ pageIndex, pageSize }}
          onPaginationChange={handlePaginationChange}
          manualFiltering
          globalFilter={searchInput}
          onGlobalFilterChange={setSearchInput}
          searchScopeOptions={SEARCH_FIELDS}
          searchScope={searchField}
          onSearchScopeChange={(v) => {
            setSearchField(v);
            setPageIndex(0);
          }}
          manualSorting
          sorting={sorting}
          onSortingChange={handleSortingChange}
        />
      </div>
    </div>
  );
}
