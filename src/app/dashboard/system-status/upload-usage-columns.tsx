'use client';

import React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { formatBytes } from './status-format';
import type { UploadCategoryUsage } from '@/lib/status/types';

/**
 * What each kind of uploaded file is taking up.
 *
 * Three numbers per row, and they mean different things: what is in use is the working set and
 * grows with the course; what is abandoned is reclaimable; what is missing is a fault. Keeping
 * them side by side is the point, because a volume filling with real work and a volume filling
 * with rubbish look identical until you separate them.
 */
export function uploadUsageColumns(): ColumnDef<UploadCategoryUsage>[] {
  const number = (value: number) => <span className="tabular-nums">{value.toLocaleString()}</span>;

  return [
    {
      accessorKey: 'label',
      header: 'Kind',
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="font-medium">{row.original.label}</div>
          {row.original.error && (
            <div className="text-destructive text-xs">{row.original.error}</div>
          )}
        </div>
      ),
      meta: { filterLabel: 'Kind' },
    },
    {
      accessorKey: 'inUseCount',
      header: 'In use',
      cell: ({ row }) => number(row.original.inUseCount),
      meta: { filterLabel: 'In use', align: 'right', nowrap: true },
    },
    {
      accessorKey: 'inUseBytes',
      header: 'Size in use',
      cell: ({ row }) => (
        <span className="tabular-nums">{formatBytes(row.original.inUseBytes)}</span>
      ),
      meta: { filterLabel: 'Size in use', align: 'right', nowrap: true },
    },
    {
      accessorKey: 'abandonedCount',
      header: 'Abandoned',
      cell: ({ row }) => (
        <div className="text-right">
          {number(row.original.abandonedCount)}
          {row.original.abandonedCount > 0 && (
            <div className="text-muted-foreground text-xs">
              {formatBytes(row.original.abandonedBytes)}
            </div>
          )}
        </div>
      ),
      meta: { filterLabel: 'Abandoned', align: 'right', nowrap: true },
    },
    {
      accessorKey: 'missingCount',
      header: 'Missing',
      cell: ({ row }) => {
        const { missingCount, missingSamples } = row.original;
        if (missingCount === 0) {
          return <span className="text-muted-foreground tabular-nums">0</span>;
        }
        return (
          <div className="text-right">
            <span className="text-destructive font-medium tabular-nums">
              {missingCount.toLocaleString()}
            </span>
            {missingSamples.length > 0 && (
              <div
                className="text-muted-foreground max-w-[24ch] truncate text-xs"
                title={missingSamples.join('\n')}
              >
                {missingSamples[0]}
              </div>
            )}
          </div>
        );
      },
      meta: { filterLabel: 'Missing', align: 'right', nowrap: true },
    },
  ];
}
