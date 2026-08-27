'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { OnChangeFn, PaginationState, SortingState } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CategoryBadge } from '@/components/ui/category-badge';
import { WorkspaceSurface } from '@/components/WorkspaceSurface';
import { DataTableFilterMenu } from '@/components/ui/data-table-faceted-filter';
import { Logs, ScrollText } from 'lucide-react';
import { LogViewerDialog } from '@/components/dialogs/LogViewerDialog';
import dynamic from 'next/dynamic';

// On demand: the export dialog is the only thing putting the form stack on this page.
const DownloadLogsDialog = dynamic(
  () => import('@/components/dialogs/DownloadLogsDialog').then((m) => m.DownloadLogsDialog),
  { ssr: false },
);
/** True once `open` has first been true, so a dynamic import stays deferred until first use. */
function useMountedOnce(open: boolean): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return mounted || open;
}
import { apiPaths } from '@/lib/api-paths';
import { LOG_CATEGORIES, LOG_SEVERITIES } from '@/lib/activity-log-values';
import { describeActivity, formatActivityDetails } from '@/lib/activity-log-summary';
import { PAGE_HEADER_ICON_CLASS } from '@/lib/page-header';

type Severity = 'INFO' | 'WARNING' | 'ERROR' | 'SECURITY';

// Shape returned by GET /api/logging. `userId` is the real id, which is what Copy JSON needs;
// `userDisplayName` is the same person in words.
type LogRow = {
  id: string;
  timestamp: string;
  userId: string | null;
  userDisplayName: string | null;
  userFirstName: string | null;
  userLastName: string | null;
  action: string;
  category: string | null;
  severity: Severity;
  metadata?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** The course, assignment, problem or submission this entry is about, named by the API. */
  related?: {
    course?: string | null;
    assignment?: string | null;
    problem?: string | null;
    submission?: string | null;
  } | null;
};

const DEFAULT_PAGE_SIZE = 10;

const SEVERITIES: readonly Severity[] = LOG_SEVERITIES;
const CATEGORIES = LOG_CATEGORIES;

// Search scope options (server-side): restrict the text search to one field.
const SEARCH_FIELDS = [
  { value: 'all', label: 'All fields' },
  { value: 'action', label: 'Action' },
  { value: 'category', label: 'Category' },
  { value: 'name', label: 'Name' },
  { value: 'email', label: 'Email' },
];

// Title-case a coded category (e.g. ASSIGNMENT → Assignment) for display.
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

// Badge palette per severity level.
const SEVERITY_VARIANT: Record<Severity, 'info' | 'warning' | 'danger' | 'destructive'> = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'danger',
  SECURITY: 'destructive',
};

export default function SystemLogsClient() {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // searchInput is what the user is typing; search is the committed (debounced)
  // query actually sent to the server.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [severities, setSeverities] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'timestamp', desc: true }]);

  const [selectedData, setSelectedData] = useState('');
  const [selectedJson, setSelectedJson] = useState('');
  const [title, setTitle] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const downloadMounted = useMountedOnce(downloadOpen);

  // Debounce typing, and jump back to the first page when the query changes.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPageIndex(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Stable, serializable description of the current query, used both as the
  // React Query cache key and to build the request params. Each distinct
  // combination of page/size/search/severity/sort is cached separately.
  const sort = sorting[0];
  const queryParams = {
    page: pageIndex + 1,
    pageSize,
    q: search || undefined,
    field: searchField !== 'all' ? searchField : undefined,
    severities,
    categories,
    sortBy: sort?.id,
    sortDir: sort ? (sort.desc ? 'desc' : 'asc') : undefined,
  };

  // Cached, server-paginated log list. keepPreviousData keeps the current page
  // visible while the next one loads, so the table doesn't flash empty.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'logs', queryParams],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(queryParams.page),
        pageSize: String(queryParams.pageSize),
      });
      if (queryParams.q) params.set('q', queryParams.q);
      if (queryParams.field) params.set('field', queryParams.field);
      queryParams.severities.forEach((s) => params.append('severity', s));
      queryParams.categories.forEach((c) => params.append('category', c));
      if (queryParams.sortBy) params.set('sortBy', queryParams.sortBy);
      if (queryParams.sortDir) params.set('sortDir', queryParams.sortDir);

      const res = await fetch(`${apiPaths.admin.logs()}?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Failed to fetch logs');
      return (await res.json()) as { rows: LogRow[]; total: number };
    },
    placeholderData: keepPreviousData,
  });

  const logs = data?.rows ?? [];
  const total = data?.total ?? 0;
  // Blocking spinner only on the cold first load; page/search/sort changes keep the
  // previous page visible (keepPreviousData) instead of flashing "loading".
  const loading = isLoading;

  const handleViewerOpen = useCallback((row: LogRow) => {
    // Readable rather than the raw row: what happened, then who and where, then the rest.
    setSelectedData(
      formatActivityDetails({
        ...row,
        metadata: row.metadata as Record<string, unknown> | null,
        related: row.related ?? null,
        userAgent: row.userAgent ?? null,
      }),
    );
    // The entry as it arrived, for the Copy JSON button: the rendered text above reads well
    // but renames things, and a bug report or a disclosure record wants the real field names.
    setSelectedJson(JSON.stringify(row, null, 2));
    const formatted = new Date(row.timestamp).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    setTitle(formatted);
    setViewerOpen(true);
  }, []);

  const handlePaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = typeof updater === 'function' ? updater({ pageIndex, pageSize }) : updater;
    setPageIndex(next.pageIndex);
    setPageSize(next.pageSize);
  };

  // Sorting is done server-side; changing it resets to the first page.
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    setSorting(next);
    setPageIndex(0);
  };

  // Columns sort server-side (see the API's orderBy). The Full Log action isn't sortable.
  // Memoized so the array keeps a stable identity across renders (otherwise the
  // DataTable re-renders every time). Only `handleViewerOpen` is closed over.
  const columns = useMemo(
    () => [
      {
        accessorKey: 'timestamp',
        header: 'Time',
        meta: { priority: 1 },
        cell: ({ getValue }: { getValue: () => unknown }) => {
          const value = getValue();
          return value
            ? new Date(value as string).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })
            : '';
        },
      },
      {
        accessorKey: 'severity',
        header: 'Severity',
        meta: { priority: 2 },
        cell: ({ getValue }: { getValue: () => unknown }) => {
          const s = ((getValue() as string) || 'INFO') as Severity;
          return <Badge variant={SEVERITY_VARIANT[s] ?? 'neutral'}>{s}</Badge>;
        },
      },
      {
        accessorKey: 'category',
        header: 'Category',
        meta: { priority: 3 },
        cell: ({ getValue }: { getValue: () => unknown }) => (
          <CategoryBadge category={getValue() as string | null} />
        ),
      },
      {
        accessorKey: 'action',
        header: 'Action',
        meta: { priority: 1 },
        cell: ({ getValue }: { getValue: () => unknown }) =>
          ((getValue() as string) || '').replace(/_/g, ' '),
      },
      {
        id: 'summary',
        header: 'What happened',
        meta: { priority: 2 },
        enableSorting: false,
        // Upper-cased to sit beside the Action column, which is upper-case because the stored
        // action is. Styled rather than transformed, so what a screen reader announces and what
        // Copy JSON carries stay in ordinary case.
        cell: ({ row }: { row: { original: LogRow } }) => (
          <span className="uppercase">
            {describeActivity(
              row.original.action,
              row.original.metadata as Record<string, unknown> | null,
            ) ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'userLastName',
        header: 'Last Name',
        meta: { priority: 2 },
        cell: ({ getValue }: { getValue: () => unknown }) => (getValue() as string) || '—',
      },
      {
        accessorKey: 'userFirstName',
        header: 'First Name',
        meta: { priority: 3 },
        cell: ({ getValue }: { getValue: () => unknown }) => (getValue() as string) || '—',
      },
      {
        accessorKey: 'ipAddress',
        header: 'IP Address',
        meta: { priority: 4 },
        cell: ({ getValue }: { getValue: () => unknown }) => {
          const ip = getValue() as string | null;
          // Strip the IPv4-mapped IPv6 prefix for readability (e.g. ::ffff:1.2.3.4).
          return ip ? ip.replace(/^::ffff:(?=\d{1,3}(?:\.\d{1,3}){3}$)/i, '') : '—';
        },
      },
      {
        id: 'viewer',
        header: 'Logs',
        meta: { priority: 1 },
        enableSorting: false,
        cell: ({ row }: { row: { original: LogRow } }) => (
          <Button onClick={() => handleViewerOpen(row.original)}>Full Log</Button>
        ),
      },
    ],
    [handleViewerOpen],
  );

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    // Same shape as the Courses page: a work page on the white surface, no outer card
    // around a table that already has a border, and a real <h1> in place of the CardTitle
    // that was carrying role="heading" aria-level={1}.
    <WorkspaceSurface>
      <section className="space-y-6" aria-labelledby="system-logs-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1
            id="system-logs-title"
            className="flex items-center gap-3 text-2xl font-semibold tracking-tight"
          >
            {/* Decorative: the heading beside it already says what this is. The icon the
                sidebar already uses for this page, on the neutral muted surface the other
                admin pages use. */}
            <Logs className={PAGE_HEADER_ICON_CLASS} aria-hidden="true" />
            <span>System Logs</span>
          </h1>
          <Button onClick={() => setDownloadOpen(true)}>Download Logs</Button>
        </div>

        {isError ? (
          <div className="border-status-danger-border bg-status-danger-bg flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <p role="alert" className="text-status-danger text-sm">
              Failed to load logs. Please try again.
            </p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : null}

          <DataTable
            columns={columns}
            // Off by default: it is a wide column and most rows have nothing to say. Somebody
            // hunting a specific change turns it on, or opens Full Log.
            defaultColumnVisibility={{ summary: false }}
            data={logs}
            loading={loading}
            tableLabel="System logs table"
            showExportButton={false}
            emptyTitle="No log entries"
            emptyDescription="No activity matches the current search and filters."
            emptyIcon={ScrollText}
            loadingMessage="Loading log entries, please wait..."
            actionButtons={
              <DataTableFilterMenu
                groups={[
                  {
                    key: 'severity',
                    label: 'Severity',
                    options: SEVERITIES.map((s) => ({ label: s, value: s })),
                    selected: severities,
                    onChange: (v) => {
                      setSeverities(v);
                      setPageIndex(0);
                    },
                  },
                  {
                    key: 'category',
                    label: 'Category',
                    options: CATEGORIES.map((c) => ({ label: titleCase(c), value: c })),
                    selected: categories,
                    onChange: (v) => {
                      setCategories(v);
                      setPageIndex(0);
                    },
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

          {/* Dialogs */}
          <LogViewerDialog
            data={selectedData}
            json={selectedJson}
            open={viewerOpen}
            onOpenChange={setViewerOpen}
            title={title}
          />
          {downloadMounted && (
            <DownloadLogsDialog open={downloadOpen} onOpenChange={setDownloadOpen} />
          )}
      </section>
    </WorkspaceSurface>
  );
}
