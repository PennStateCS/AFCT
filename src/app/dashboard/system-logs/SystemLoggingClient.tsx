'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OnChangeFn, PaginationState } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

export default function SystemLoggingClient() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // searchInput is what the user is typing; search is the committed (debounced)
  // query actually sent to the server.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState<Severity | typeof ALL_SEVERITIES>(ALL_SEVERITIES);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const params = new URLSearchParams({
        page: String(pageIndex + 1),
        pageSize: String(pageSize),
      });
      if (search) params.set('q', search);
      if (severity !== ALL_SEVERITIES) params.set('severity', severity);

      const res = await fetch(`/api/logging?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch logs');
      const data: { rows: LogRow[]; total: number } = await res.json();
      setLogs(data.rows ?? []);
      setTotal(data.total ?? 0);
    } catch (error) {
      setLoadError('Failed to load logs. Please try again.');
      console.error('Error loading logs:', error);
    } finally {
      setLoading(false);
    }
  }, [pageIndex, pageSize, search, severity]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const handleViewerOpen = (row: LogRow) => {
    setSelectedData(JSON.stringify(row, null, 2));
    const formatted = new Date(row.timestamp).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    setTitle(formatted);
    setViewerOpen(true);
  };

  const handlePaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = typeof updater === 'function' ? updater({ pageIndex, pageSize }) : updater;
    setPageIndex(next.pageIndex);
    setPageSize(next.pageSize);
  };

  // Server controls order and paging, so columns aren't client-sortable.
  const columns = [
    {
      accessorKey: 'timestamp',
      header: 'Time',
      enableSorting: false,
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
      enableSorting: false,
      cell: ({ getValue }: { getValue: () => unknown }) => {
        const s = ((getValue() as string) || 'INFO') as Severity;
        return <Badge variant={SEVERITY_VARIANT[s] ?? 'neutral'}>{s}</Badge>;
      },
    },
    { accessorKey: 'userId', header: 'User', enableSorting: false },
    { accessorKey: 'category', header: 'Category', enableSorting: false },
    { accessorKey: 'action', header: 'Action', enableSorting: false },
    {
      id: 'viewer',
      header: 'Logs',
      enableSorting: false,
      cell: ({ row }: { row: { original: LogRow } }) => (
        <Button onClick={() => handleViewerOpen(row.original)}>Full Log</Button>
      ),
    },
  ];

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
        {loadError ? (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2">
            <p role="alert" className="text-sm text-red-700">
              {loadError}
            </p>
            <Button variant="outline" size="sm" onClick={() => void fetchLogs()}>
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
