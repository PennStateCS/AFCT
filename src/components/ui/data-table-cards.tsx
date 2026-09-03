'use client';

/* eslint-disable jsx-a11y/no-redundant-roles -- role="list" is not redundant here.
   Tailwind's preflight sets `list-style: none` on every list, and Safari with VoiceOver
   drops list semantics from a list that has no markers, so the explicit role is what puts
   "list, 3 items" back. It also settles axe's aria-prohibited-attr warning, which is that
   naming a bare <ul> has patchy support. Remove the role only if the marker reset goes. */

import { useState, useEffect, type ComponentType, type ReactNode } from 'react';
import type { Row, Table as TanstackTable, Column as TanstackColumn } from '@tanstack/react-table';
import { flexRender } from '@tanstack/react-table';
import { Inbox } from 'lucide-react';
import { DataTableLoading, DataTableEmptyState } from '@/components/ui/data-table-status';
import { cn } from '@/lib/utils';

/**
 * Stacked card view for narrow screens: each row becomes a card of label/value pairs
 * (labels are the column headers, values the same cell renderers as the table). Avoids the
 * sideways scroll a wide table forces on a phone.
 *
 * Where the row's actions go depends on what they are, which the column says through
 * `meta.mobileActionPlacement`:
 *
 * - an overflow menu (the ordinary case) sits in the card's top-right corner, the way it
 *   sits at the end of its row in the table. In a footer it read as an action belonging to
 *   the list rather than to the record, which is what a lone ellipsis under a divider
 *   looks like;
 * - a larger group (text buttons, a Restore beside a Delete) keeps a footer row, because
 *   36px of corner cannot hold it;
 * - a row with no actions column gets neither, and no space reserved for one.
 *
 * The placement is all this component decides. The cell itself is still the column's own
 * renderer, so what the menu contains and what it is called stay where they were.
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
    <ul role="list" className="space-y-3" aria-label={tableLabel} aria-busy={loading}>
      {rows.map((row: Row<TData>) => {
        const cells = row.getVisibleCells();
        const actionsCell = cells.find((c) => c.column.id === 'actions');
        const bodyCells = cells.filter(
          (c) => c.column.id !== 'actions' && !c.column.columnDef.meta?.mobileHidden,
        );
        // Corner unless the column asks for a footer: nearly every actions cell in AFCT is
        // one icon-only overflow menu, and the exceptions know they are exceptions.
        //
        // Known limitation: a cell that renders nothing for a particular row (an action the
        // row cannot offer) still reserves its corner, because the only way to know it came
        // back empty would be to inspect what it rendered. An empty 44px inset on one line
        // is a better trade than that.
        const placement = actionsCell?.column.columnDef.meta?.mobileActionPlacement ?? 'corner';
        const cornerAction = actionsCell && placement === 'corner';
        const footerAction = actionsCell && placement === 'footer';
        return (
          // `relative` for the corner action, and no `overflow-hidden`: the menu itself is
          // portaled, but a clipped card would still cut the trigger's focus ring.
          <li key={row.id} className="relative rounded-md border bg-[var(--table-background)] p-4">
            {/* One gutter down the whole column rather than an inset on the first line only.
                The corner action sets where content can safely end, and a card whose first
                value stopped 44px short while every value below it ran on to the border read
                as a ragged edge. 32px clears the 36px trigger (which starts 44px in from the
                card's edge, against the list's 16px padding) with room to spare, and costs
                less width at 320px than the inset it replaces. */}
            <dl className={cn('grid gap-2', cornerAction && 'pr-8')}>
              {bodyCells.map((cell) => (
                // min-w-0: a grid item refuses to shrink below its content's min-content
                // width by default, so one wide value (a nowrap cell, a long address)
                // pushed the whole row past the edge of the card. Allowing the row to
                // shrink lets the value wrap or truncate inside the card instead.
                <div
                  key={cell.id}
                  className="flex min-w-0 items-start justify-between gap-4 text-sm"
                >
                  {/* The label shrinks and wraps for the same reason the value does: a long
                      column name beside a long value pushed the row past the card's edge,
                      and how long either of them looks depends on the reader's font size. */}
                  <dt className="text-muted-foreground min-w-0 font-medium break-words">
                    {getColumnLabel(cell.column)}
                  </dt>
                  {/* Cells keep `whitespace-nowrap` so a date or an ID is not broken across
                      lines *in the table*, where there is sideways room. In a card there is
                      none, and a nowrap value simply runs out past the border: min-w-0 lets the
                      box shrink but cannot make text that refuses to wrap wrap. So the card
                      overrides it for everything inside, which is safe because the whole point
                      of this view is that a value gets as many lines as it needs. */}
                  <dd className="min-w-0 text-right break-words [&_*]:whitespace-normal">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </dd>
                </div>
              ))}
            </dl>
            {/* Top-right, inset from the corner so the trigger's focus ring has somewhere to
                land. `size="icon"` triggers are 36px, which is the touch target; the icon
                inside them stays 16px. Aligned with the first field's line. */}
            {cornerAction ? (
              <div className="absolute top-2 right-2">
                {flexRender(actionsCell.column.columnDef.cell, actionsCell.getContext())}
              </div>
            ) : null}

            {footerAction ? (
              <div className="mt-3 flex justify-end gap-2 border-t pt-3">
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
 * Below 640px, present rows as stacked cards instead of a horizontally scrolling
 * table. Above that the table stays, shedding lower-priority columns as it narrows
 * (see `responsiveClass`), so it condenses through several stages before cards.
 * Guards against jsdom / SSR where matchMedia is absent: returns false until mounted,
 * so the server and tests render the desktop table.
 */
export function useStackedView() {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(max-width: 639px)');
    const update = () => setStacked(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
  return stacked;
}
