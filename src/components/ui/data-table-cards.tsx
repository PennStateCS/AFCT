'use client';

import { useState, useEffect, type ComponentType, type ReactNode } from 'react';
import type { Row, Table as TanstackTable, Column as TanstackColumn } from '@tanstack/react-table';
import { flexRender } from '@tanstack/react-table';
import { Inbox } from 'lucide-react';
import { DataTableLoading, DataTableEmptyState } from '@/components/ui/data-table-status';

/**
 * Stacked card view for narrow screens: each row becomes a card of label/value
 * pairs (labels are the column headers, values the same cell renderers as the
 * table), with the actions column pinned to the card footer. Avoids the sideways
 * scroll a wide table forces on a phone.
 */
export function DataTableCards<TData>({
  table,
  loading,
  tableLabel,
  getColumnLabel,
  emptyTitle = 'No data found',
  emptyDescription = 'Try adjusting filters or adding new entries.',
  emptyIcon: EmptyIcon = Inbox,
  loadingMessage = 'Loading data, please wait...',
  emptyAction,
}: {
  table: TanstackTable<TData>;
  loading: boolean;
  tableLabel: string;
  getColumnLabel: (column: TanstackColumn<TData, unknown>) => string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  loadingMessage?: string;
  emptyAction?: ReactNode;
}) {
  if (loading) {
    return <DataTableLoading message={loadingMessage} className="rounded-md border py-10" />;
  }

  const rows = table.getRowModel().rows;
  if (!rows.length) {
    return (
      <DataTableEmptyState
        icon={EmptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        className="rounded-md border py-8"
      />
    );
  }

  return (
    <ul className="space-y-3" aria-label={tableLabel} aria-busy={loading}>
      {rows.map((row: Row<TData>) => {
        const cells = row.getVisibleCells();
        const actionsCell = cells.find((c) => c.column.id === 'actions');
        const bodyCells = cells.filter(
          (c) => c.column.id !== 'actions' && !c.column.columnDef.meta?.mobileHidden,
        );
        return (
          <li key={row.id} className="rounded-md border bg-[var(--table-background)] p-4">
            <dl className="grid gap-2">
              {bodyCells.map((cell) => (
                <div key={cell.id} className="flex items-start justify-between gap-4 text-sm">
                  <dt className="text-muted-foreground font-medium">
                    {getColumnLabel(cell.column)}
                  </dt>
                  <dd className="min-w-0 text-right break-words">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </dd>
                </div>
              ))}
            </dl>
            {actionsCell ? (
              <div className="mt-3 flex justify-end border-t pt-3">
                {flexRender(actionsCell.column.columnDef.cell, actionsCell.getContext())}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Below 768px, present rows as stacked cards instead of a horizontally scrolling
 * table. Guards against jsdom / SSR where matchMedia is absent: returns false
 * until mounted, so the server and tests render the desktop table.
 */
export function useStackedView() {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(max-width: 767px)');
    const update = () => setStacked(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
  return stacked;
}
