'use client';

import React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { DataTable } from '@/components/ui/data-table';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { UserRoundPlus, Users } from 'lucide-react';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import type { EnhancedActivityLogData } from '@/lib/activity-log-utils';
import { LogViewerDialog } from '@/components/dialogs/LogViewerDialog';

export default function SystemLoggingClient({ initialLogs }: { initialLogs?: EnhancedActivityLogData[] }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const hasInitialLogs = Array.isArray(initialLogs);

  const [logs, setLogs] = useState<EnhancedActivityLogData[]>(initialLogs ?? []);
  const [loading, setLoading] = useState(!hasInitialLogs);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedData, setSelectedData] = useState('');
  const [title, setTitle] = useState('');
  const [open, setOpen] = useState(false);
  const { timezone } = useEffectiveTimezone();

  const handleOpen = (row: any) => {
    setSelectedData(JSON.stringify(row, null, 2));
	const formatted = new Date(row.timestamp).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
    setTitle(formatted);
    setOpen(true);
  };

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null); 
      const res = await fetch('/api/logging', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch users');
      const data: EnhancedActivityLogData[] = await res.json();
	  setLogs(data);
    } catch (error) {
      setLoadError('Failed to load logs. Please try again.');
      console.error('Error loading logs:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasInitialLogs) {
      void fetchLogs();
    }
  }, [fetchLogs, hasInitialLogs]);

  const columns = [
    {
      accessorKey: 'timestamp',
	  header: 'Time',
	  cell: ({ getValue: () => any  }) => {
	    const value = getValue();
		return value
		  ? new Date(value).toLocaleString(undefined, {
		    dateStyle: 'medium',
            timeStyle: 'short'
		  })
		: '';
	  } 
	}, 
	{
      accessorKey: 'userId',
	  header: 'User'
    },
	{
	  accessorKey: 'category',
	  header: 'Category'
    },
	{
	  accessorKey: 'action',
	  header: 'Action'
    },
	{
      id: 'viewer',
      header: 'Logs',
	  cell: ({ row: any }) => (
        <Button onClick={() => handleOpen(row.original)}>
          Full Log
        </Button>
      )
	}
  ];

  const handleDialogClose = (value: boolean) => {
    setOpen(value);
    if (!value) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('create');
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  };

  return (
    <Card className="p-4">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle role="heading" aria-level={1} className="text-2xl">
          System Logs
        </CardTitle>
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
          tableLabel="Users table"
          defaultColumnVisibility={{ createdAt: false }}
        />
		<LogViewerDialog
          data={selectedData}
          open={open}
          onOpenChange={setOpen}
          title={title}
        />
      </CardContent>
    </Card>
  );
}
