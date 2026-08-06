'use client';

import { useEffect, useState } from 'react';
import type { User } from '@prisma/client';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { ColumnDef, OnChangeFn, PaginationState, SortingState } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { DataTableFilterMenu } from '@/components/ui/data-table-faceted-filter';
import { Plus, Users, GraduationCap } from 'lucide-react';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import type { RosterMemberRow } from '@/lib/course-roster-list';

interface RosterCardProps {
  courseId: string;
  courseIsArchived: boolean;
  userColumns: ColumnDef<User>[];
  onEnrollUser: () => void;
  onBulkEnroll?: () => void;
}

const DEFAULT_PAGE_SIZE = 10;

// Search scope (server-side): restrict the text search to one field.
const SEARCH_FIELDS = [
  { value: 'all', label: 'All fields' },
  { value: 'name', label: 'Name' },
  { value: 'email', label: 'Email' },
];

/**
 * The course roster, one page at a time.
 *
 * A course can carry a thousand students, so search, filters, sort and pagination all run
 * in the database and this component holds a single page. The rows no longer arrive with
 * the course payload, which is why it takes a `courseId` rather than an array.
 */
export function RosterCard({
  courseId,
  courseIsArchived,
  userColumns,
  onEnrollUser,
  onBulkEnroll,
}: RosterCardProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // searchInput is what the user is typing; search is the committed (debounced) query.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');

  const [roles, setRoles] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);

  // Surname order, which is how a roster reads and how staff look someone up.
  const [sorting, setSorting] = useState<SortingState>([{ id: 'lastName', desc: false }]);

  // Debounce typing, and jump back to the first page when the query changes.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPageIndex(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const sort = sorting[0];
  // One serializable object, used as both the react-query key and the request, so the
  // cache can never disagree with what was actually asked for.
  const query = {
    page: pageIndex + 1,
    pageSize,
    q: search || undefined,
    field: searchField,
    role: roles,
    status: statuses,
    sortBy: sort?.id,
    sortDir: sort?.desc ? 'desc' : 'asc',
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.course.rosterPage(courseId, query),
    queryFn: async () => {
      const res = await fetch(apiPaths.courseRosterList(courseId, query), { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load the roster');
      return (await res.json()) as { rows: RosterMemberRow[]; total: number };
    },
    // Holds the current page on screen while the next one loads, so paging does not flash
    // an empty table. The table's `loading` is driven by isLoading (the cold first load)
    // rather than isFetching for the same reason: telling it "loading" on every page
    // change would replace those rows with the placeholder anyway.
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
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

  const anyFilterActive = roles.length > 0 || statuses.length > 0 || searchInput.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-row items-center justify-between">
        <h2 className="flex items-center gap-2 text-2xl font-semibold">
          <GraduationCap className="h-5 w-5" />
          Roster
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="default" onClick={onEnrollUser} hidden={courseIsArchived}>
            <Plus />
            Enroll User
          </Button>
          <Button variant="default" onClick={() => onBulkEnroll?.()} hidden={courseIsArchived}>
            <Users className="mr-1" />
            Bulk Enroll
          </Button>
        </div>
      </div>

      {isError ? (
        <div className="border-status-danger-border bg-status-danger-bg mb-4 flex items-center justify-between gap-3 rounded-md border px-3 py-2">
          <p role="alert" className="text-status-danger text-sm">
            Failed to load the roster. Please try again.
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      <DataTable
        columns={userColumns as ColumnDef<User>[]}
        data={rows as unknown as User[]}
        loading={isLoading}
        tableLabel="Course roster table"
        // Its own entry: without a key it shared the default one with every other unnamed
        // table in the app, so hiding a column here hid it on unrelated pages.
        storageKey="course-roster-columns-v1"
        // The browser holds one page, so an export from here would silently write that page
        // and call it the roster.
        showExportButton={false}
        emptyTitle={anyFilterActive ? 'No one matches your filters' : 'No one enrolled yet'}
        emptyDescription={
          anyFilterActive
            ? 'Try clearing the search, role, or status filter.'
            : courseIsArchived
              ? 'This course was archived with an empty roster.'
              : 'Use Enroll User or Bulk Enroll to add students and staff.'
        }
        emptyIcon={GraduationCap}
        loadingMessage="Loading roster, please wait..."
        actionButtons={
          <DataTableFilterMenu
            groups={[
              {
                key: 'role',
                label: 'Role',
                options: [
                  { label: 'Faculty', value: 'FACULTY' },
                  { label: 'TA', value: 'TA' },
                  { label: 'Student', value: 'STUDENT' },
                ],
                selected: roles,
                onChange: onFilter(setRoles),
              },
              {
                // Its own group, so it ANDs with Role: Student plus Dropped finds dropped
                // students rather than widening to every student and everyone dropped.
                key: 'status',
                label: 'Status',
                options: [
                  { label: 'Enrolled', value: 'ENROLLED' },
                  { label: 'Dropped', value: 'DROPPED' },
                ],
                selected: statuses,
                onChange: onFilter(setStatuses),
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
  );
}
