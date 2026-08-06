/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';

import { getActivityColumns, type ActivityLog } from './activity-columns';

/**
 * The columns are fed straight from `GET /api/courses/[id]/activity`, so this pins what
 * they read off a row and which of them offer sorting. `ActivityCard`'s own test stubs
 * `DataTable`, so nothing else exercises these renderers.
 */
const columns = () => getActivityColumns('UTC') as ColumnDef<ActivityLog>[];

const columnById = (id: string) => {
  const found = columns().find(
    (c) => c.id === id || (c as { accessorKey?: string }).accessorKey === id,
  );
  if (!found) throw new Error(`No ${id} column`);
  return found;
};

/** Render one column's cell against a server-shaped row. */
const renderCell = (id: string, row: Partial<ActivityLog>) => {
  const Cell = columnById(id).cell as (ctx: unknown) => React.ReactElement;
  return render(<>{Cell({ row: { original: row } })}</>);
};

const baseRow: Partial<ActivityLog> = {
  id: 'log-1',
  action: 'GRADE_UPDATED',
  category: 'GRADE',
  timestamp: '2026-03-01T12:00:00.000Z',
  user: {
    id: 'u1',
    email: 'ada@x.edu',
    firstName: 'Ada',
    lastName: 'Lovelace',
  } as ActivityLog['user'],
};

describe('activity columns', () => {
  it('title-cases the action for display', () => {
    renderCell('action', baseRow);

    expect(screen.getByText('Grade Updated')).toBeInTheDocument();
  });

  it('falls back to Unknown / User when the actor was deleted', () => {
    // userId is nullable and the relation is SetNull, so a row can outlive its author.
    renderCell('user.firstName', { ...baseRow, user: undefined });
    expect(screen.getByText('Unknown')).toBeInTheDocument();

    renderCell('user.lastName', { ...baseRow, user: undefined });
    expect(screen.getByText('User')).toBeInTheDocument();
  });

  it('reads the assignment title from the relation', () => {
    renderCell('assignment', {
      ...baseRow,
      assignment: { id: 'a1', title: 'Homework 1' } as ActivityLog['assignment'],
    });

    expect(screen.getByText('Homework 1')).toBeInTheDocument();
  });

  it('falls back to a title recorded in metadata on older events', () => {
    // Older rows recorded only a title, not a relation id. Those still display, but they
    // are exactly the rows an assignment-id filter cannot match.
    renderCell('assignment', {
      ...baseRow,
      assignment: undefined,
      metadata: { assignmentTitle: 'Legacy Homework' },
    });

    expect(screen.getByText('Legacy Homework')).toBeInTheDocument();
  });

  describe('sorting', () => {
    const sortableOf = (id: string) => columnById(id).enableSorting;

    it('allows sorting on the columns the server can order by', () => {
      // Mirrors ACTIVITY_ORDER_BY in the route.
      expect(sortableOf('category')).toBe(true);
    });

    it('does not offer sorting on the derived Assignment and Problem columns', () => {
      // Their displayed title comes from a relation with metadata fallbacks, so the server
      // has no single column to order the whole log by. A sort control here would claim an
      // ordering it silently could not deliver.
      expect(sortableOf('assignment')).toBe(false);
      expect(sortableOf('problem')).toBe(false);
    });

    it('exposes no client-side faceted filters', () => {
      // Filtering is server-side through the toolbar's Filters menu; a column-level facet
      // could only narrow the page on screen.
      for (const col of columns()) {
        expect((col.meta as { filterVariant?: string } | undefined)?.filterVariant).toBeUndefined();
      }
    });
  });
});
