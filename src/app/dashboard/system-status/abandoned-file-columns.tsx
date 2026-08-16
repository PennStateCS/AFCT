'use client';

import React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTimeInTimeZone } from '@/lib/date-format';
import { formatBytes } from './status-format';
import type { AbandonedFile } from '@/lib/status/types';

/**
 * The abandoned-uploads table.
 *
 * Every column here answers a question somebody deciding whether to delete a file actually
 * asks: what kind of file is it, what is it called, how much space would go, and how long has
 * it been sitting there. The size is the point of the page, so the table arrives sorted by it.
 */
export function abandonedFileColumns({
  labels,
  timeZone,
  onDelete,
  deleting,
}: {
  /** Category name to its plain-language label, so the badge is not a folder name. */
  labels: Record<string, string>;
  timeZone: string;
  onDelete: (file: AbandonedFile) => void;
  /** The file currently being deleted, if any. */
  deleting: { category: string; fileName: string } | null;
}): ColumnDef<AbandonedFile>[] {
  return [
    {
      accessorKey: 'category',
      header: 'Kind',
      cell: ({ row }) => (
        <Badge variant="neutral">{labels[row.original.category] ?? row.original.category}</Badge>
      ),
      // A multi-select so an admin can look at one kind at a time; with several thousand
      // rows the question is usually "show me just the submissions".
      meta: { filterLabel: 'Kind', filterVariant: 'multiselect', nowrap: true },
    },
    {
      accessorKey: 'fileName',
      header: 'File',
      cell: ({ row }) => (
        // The stored name is a bare UUID, which tells a reader nothing on its own; the full
        // path underneath is what they would use to find it on the server.
        <div className="min-w-0">
          <div className="font-mono text-xs break-all">{row.original.fileName}</div>
          <div
            className="text-muted-foreground max-w-[46ch] truncate text-xs"
            title={row.original.path}
          >
            {row.original.path}
          </div>
        </div>
      ),
      meta: { filterLabel: 'File' },
    },
    {
      accessorKey: 'sizeBytes',
      header: 'Size',
      cell: ({ row }) => (
        <span className="tabular-nums">{formatBytes(row.original.sizeBytes)}</span>
      ),
      meta: { filterLabel: 'Size', align: 'right', nowrap: true },
    },
    {
      accessorKey: 'modifiedAt',
      header: 'Last changed',
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">
          {formatDateTimeInTimeZone(row.original.modifiedAt, timeZone)}
        </span>
      ),
      meta: { filterLabel: 'Last changed', nowrap: true },
    },
    {
      id: 'actions',
      header: 'Action',
      enableSorting: false,
      cell: ({ row }) => {
        const file = row.original;
        const busy = deleting?.category === file.category && deleting?.fileName === file.fileName;
        return (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDelete(file)}
            // The visible word is "Delete"; the accessible name has to say what it deletes,
            // and a bare UUID read aloud is not that, so the kind comes first.
            aria-label={`Delete ${labels[file.category] ?? file.category} file ${file.fileName}`}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        );
      },
      meta: { filterLabel: 'Action', align: 'right', nowrap: true },
    },
  ];
}
