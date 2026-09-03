'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { OnChangeFn, PaginationState, SortingState } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { DataTableFilterMenu } from '@/components/ui/data-table-faceted-filter';
import {
  actorName,
  getActivityColumns,
  relatedRecords,
  type ActivityLog,
} from '@/app/dashboard/courses/[id]/activity-columns';
import { LogViewerDialog } from '@/components/dialogs/LogViewerDialog';
import { formatActivityDetails } from '@/lib/activity-log-summary';
import { formatDateTimeInTimeZone } from '@/lib/date-format';
import { Activity } from 'lucide-react';
import { showToast } from '@/lib/toast';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { LOG_CATEGORIES } from '@/lib/activity-log-values';

const DEFAULT_PAGE_SIZE = 50;

// Search scope (server-side): restrict the text search to one field.
const SEARCH_FIELDS = [
  { value: 'all', label: 'All fields' },
  { value: 'action', label: 'Action' },
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
  const { timezone, hour12 } = useEffectiveTimezone();

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

  // The details dialog, opened from a row's Details button. The state lives here rather than
  // in the cell: one dialog for the table, the way System Logs does it. The popover it
  // replaces was per-row, and closed as soon as you clicked into it to select anything.
  const [detailsText, setDetailsText] = useState('');
  const [detailsJson, setDetailsJson] = useState('');
  const [detailsTitle, setDetailsTitle] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);

  const handleViewDetails = useCallback(
    (activity: ActivityLog) => {
      // Readable rather than the raw row: what happened, then who and where, then the rest.
      setDetailsText(
        formatActivityDetails({
          action: activity.action,
          userDisplayName: actorName(activity),
          timestamp: activity.timestamp,
          severity: activity.severity ?? null,
          category: activity.category ?? null,
          ipAddress: activity.ipAddress ?? null,
          userAgent: activity.userAgent ?? null,
          metadata: activity.metadata,
          related: relatedRecords(activity),
          // The same zone the table and this dialog's title use, rather than the browser's.
          timeZone: timezone,
          hour12,
        }),
      );
      // The entry as it arrived, for the Copy JSON button: the rendered text above reads well
      // but renames things, and a bug report or a disclosure record wants the real field names.
      setDetailsJson(JSON.stringify(activity, null, 2));
      // The table's timezone, not the browser's, so the dialog and the row it came from agree.
      setDetailsTitle(formatDateTimeInTimeZone(activity.timestamp, timezone, hour12));
      setDetailsOpen(true);
    },
    [timezone, hour12],
  );

  // Memoize columns so a re-render doesn't recreate the array (and its cell
  // components), which would force DataTable and its rows to re-render.
  const columns = useMemo(
    () => getActivityColumns(timezone, courseId, handleViewDetails, hour12),
    [timezone, courseId, handleViewDetails, hour12],
  );

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

  const { data, isLoading, isError, error } = useQuery({
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

  return (
    <div className="space-y-6">
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        <Activity className="h-5 w-5" />
        Activity
      </h2>
      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        tableLabel="Activity log table"
        // Its own entry: without a key it shared the default one with every other unnamed
        // table, so hiding a column here hid it on unrelated pages.
        // v2: the columns changed shape when this table took the System Logs layout, and the
        // saved visibility map is keyed by column id.
        storageKey="course-activity-columns-v2"
        // Severity and Category are off to start with: on a course feed nearly every entry is
        // INFO, and the category mostly repeats what the Action and Subject columns already
        // say. Both are in the Columns menu for the times they matter.
        defaultColumnVisibility={{ severity: false, category: false }}
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
      <LogViewerDialog
        data={detailsText}
        json={detailsJson}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title={detailsTitle}
      />
    </div>
  );
}
