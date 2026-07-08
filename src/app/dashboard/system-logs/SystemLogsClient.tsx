'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { OnChangeFn, PaginationState, SortingState } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CategoryBadge } from '@/components/ui/category-badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { LogViewerDialog } from '@/components/dialogs/LogViewerDialog';
import { DownloadLogsDialog } from '@/components/dialogs/DownloadLogsDialog';

type Severity = 'INFO' | 'WARNING' | 'ERROR' | 'SECURITY';

// Shape returned by GET /api/logging (userId is resolved to a display name).
type LogRow = {
  id: string;
  timestamp: string;
  userId: string | null;
  userFirstName: string | null;
  userLastName: string | null;
  action: string;
  category: string | null;
  severity: Severity;
  metadata?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
};

const DEFAULT_PAGE_SIZE = 10;

const SEVERITIES: Severity[] = ['INFO', 'WARNING', 'ERROR', 'SECURITY'];
const ALL_SEVERITIES = 'ALL';

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
  const [severity, setSeverity] = useState<Severity | typeof ALL_SEVERITIES>(ALL_SEVERITIES);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'timestamp', desc: true }]);

  const [selectedData, setSelectedData] = useState('');
  const [title, setTitle] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

  // Debounce typing, and jump back to the first page when the query changes.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPageIndex(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Stable, serializable description of the current query — used both as the
  // React Query cache key and to build the request params. Each distinct
  // combination of page/size/search/severity/sort is cached separately.
  const sort = sorting[0];
  const queryParams = {
    page: pageIndex + 1,
    pageSize,
    q: search || undefined,
    severity: severity !== ALL_SEVERITIES ? severity : undefined,
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
      if (queryParams.severity) params.set('severity', queryParams.severity);
      if (queryParams.sortBy) params.set('sortBy', queryParams.sortBy);
      if (queryParams.sortDir) params.set('sortDir', queryParams.sortDir);

      const res = await fetch(`/api/admin/logs?${params.toString()}`, { cache: 'no-store' });
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
    setSelectedData(JSON.stringify(row, null, 2));
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
        cell: ({ getValue }: { getValue: () => unknown }) => {
          const s = ((getValue() as string) || 'INFO') as Severity;
          return <Badge variant={SEVERITY_VARIANT[s] ?? 'neutral'}>{s}</Badge>;
        },
      },
      {
        accessorKey: 'category',
        header: 'Category',
        cell: ({ getValue }: { getValue: () => unknown }) => (
          <CategoryBadge category={getValue() as string | null} />
        ),
      },
      {
        accessorKey: 'action',
        header: 'Action',
        cell: ({ getValue }: { getValue: () => unknown }) =>
          ((getValue() as string) || '').replace(/_/g, ' '),
      },
      {
        accessorKey: 'userLastName',
        header: 'Last Name',
        cell: ({ getValue }: { getValue: () => unknown }) => (getValue() as string) || '—',
      },
      {
        accessorKey: 'userFirstName',
        header: 'First Name',
        cell: ({ getValue }: { getValue: () => unknown }) => (getValue() as string) || '—',
      },
      {
        accessorKey: 'ipAddress',
        header: 'IP Address',
        cell: ({ getValue }: { getValue: () => unknown }) => {
          const ip = getValue() as string | null;
          // Strip the IPv4-mapped IPv6 prefix for readability (e.g. ::ffff:1.2.3.4).
          return ip ? ip.replace(/^::ffff:(?=\d{1,3}(?:\.\d{1,3}){3}$)/i, '') : '—';
        },
      },
      {
        id: 'viewer',
        header: 'Logs',
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
    <Card className="p-4">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle role="heading" aria-level={1} className="text-2xl">
          System Logs
        </CardTitle>
        <Button onClick={() => setDownloadOpen(true)}>Download Logs</Button>
      </CardHeader>

      <CardContent>
        {isError ? (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2">
            <p role="alert" className="text-sm text-red-700">
              Failed to load logs. Please try again.
            </p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : null}

        <DataTable
          columns={columns}
          data={logs}
          loading={loading}
          tableLabel="System logs table"
          showExportButton={false}
          actionButtons={
            <Select
              value={severity}
              onValueChange={(v) => {
                setSeverity(v as Severity | typeof ALL_SEVERITIES);
                setPageIndex(0);
              }}
            >
              <SelectTrigger aria-label="Filter by severity" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SEVERITIES}>All severities</SelectItem>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
          manualPagination
          pageCount={pageCount}
          rowCount={total}
          pagination={{ pageIndex, pageSize }}
          onPaginationChange={handlePaginationChange}
          manualFiltering
          globalFilter={searchInput}
          onGlobalFilterChange={setSearchInput}
          manualSorting
          sorting={sorting}
          onSortingChange={handleSortingChange}
        />

        {/* Dialogs */}
        <LogViewerDialog
          data={selectedData}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          title={title}
        />
        <DownloadLogsDialog open={downloadOpen} onOpenChange={setDownloadOpen} />
      </CardContent>
    </Card>
  );
}
