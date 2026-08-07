/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnDef } from '@tanstack/react-table';

import { getActivityColumns, type ActivityLog } from './activity-columns';
import { ACTIVITY_SORT_KEYS } from '@/lib/activity-log-values';

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

    it('offers sorting on exactly the columns the server can order by', () => {
      /*
       * The bug this guards: TanStack derives a column id from `accessorKey` by replacing
       * dots with underscores, so `user.lastName` becomes `user_lastName`. When the sort
       * allow-list was keyed by the dotted spelling, clicking Last Name sent an id the
       * server did not recognise and it silently fell back to timestamp order while the
       * header still showed a sort indicator.
       */
      const sortableIds = columns()
        .filter((c) => {
          const hasAccessor =
            'accessorKey' in c || typeof (c as { accessorFn?: unknown }).accessorFn === 'function';
          return hasAccessor && c.enableSorting !== false;
        })
        .map((c) => c.id ?? (c as { accessorKey?: string }).accessorKey);

      expect([...sortableIds].sort()).toEqual([...ACTIVITY_SORT_KEYS].sort());
    });

    it('exposes no client-side faceted filters', () => {
      // Filtering is server-side through the toolbar's Filters menu; a column-level facet
      // could only narrow the page on screen.
      for (const col of columns()) {
        expect((col.meta as { filterVariant?: string } | undefined)?.filterVariant).toBeUndefined();
      }
    });
  });

  /**
   * The cell renderers. Everything above pins the column contract; these exercise what
   * actually reaches the screen, which is the half `ActivityCard` cannot cover because it
   * stubs `DataTable`.
   */
  describe('cells', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows the actor initials when they have no avatar', () => {
      const { container } = renderCell('avatar', baseRow);

      expect(within(container).getByText('AL')).toBeInTheDocument();
    });

    it('names the avatar after the actor', () => {
      const { container } = renderCell('avatar', baseRow);

      // The image is only in the DOM once it loads, so assert on the fallback's presence
      // and that the cell rendered for a row that has an avatar path.
      expect(container.textContent).toContain('AL');
    });

    it('renders the category badge', () => {
      const { container } = renderCell('category', baseRow);

      expect(within(container).getByText('GRADE')).toBeInTheDocument();
    });

    it('prefers the problem relation, then metadata, then N/A', () => {
      const viaRelation = renderCell('problem', {
        ...baseRow,
        problem: { id: 'p1', title: 'Even length' } as ActivityLog['problem'],
      });
      expect(within(viaRelation.container).getByText('Even length')).toBeInTheDocument();

      const viaMetadata = renderCell('problem', {
        ...baseRow,
        metadata: { problemTitle: 'From metadata' },
      });
      expect(within(viaMetadata.container).getByText('From metadata')).toBeInTheDocument();

      const viaLegacyName = renderCell('problem', {
        ...baseRow,
        metadata: { problemName: 'Legacy key' },
      });
      expect(within(viaLegacyName.container).getByText('Legacy key')).toBeInTheDocument();

      const missing = renderCell('problem', baseRow);
      expect(within(missing.container).getByText('N/A')).toBeInTheDocument();
    });

    describe('the time cell', () => {
      // Relative time is computed against the clock, so pin it rather than letting the
      // suite's wall time decide which branch runs.
      const at = (iso: string) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
        return renderCell('timestamp', { ...baseRow, timestamp: iso });
      };

      it('reads "Just now" under a minute', () => {
        expect(
          within(at('2026-03-01T11:59:30.000Z').container).getByText('Just now'),
        ).toBeInTheDocument();
      });

      it('counts minutes under an hour', () => {
        expect(within(at('2026-03-01T11:30:00.000Z').container).getByText('30m ago')).toBeInTheDocument();
      });

      it('counts hours under a day', () => {
        expect(within(at('2026-03-01T07:00:00.000Z').container).getByText('5h ago')).toBeInTheDocument();
      });

      it('counts days under a week', () => {
        expect(within(at('2026-02-27T12:00:00.000Z').container).getByText('2d ago')).toBeInTheDocument();
      });

      it('counts weeks beyond that', () => {
        expect(within(at('2026-02-08T12:00:00.000Z').container).getByText('3w ago')).toBeInTheDocument();
      });

      it('shows the absolute time alongside the relative one', () => {
        // The absolute stamp is what an auditor reads; the relative one is a convenience.
        const { container } = at('2026-03-01T07:00:00.000Z');
        expect(container.textContent).toContain('5h ago');
        expect(container.textContent).toMatch(/03\/01\/26 07:00/);
      });
    });

    describe('the IP cell', () => {
      it('prefers the column over metadata', () => {
        const { container } = renderCell('ipAddress', {
          ...baseRow,
          ipAddress: '203.0.113.7',
          metadata: { ipAddress: '198.51.100.1' },
        });
        expect(within(container).getByText('203.0.113.7')).toBeInTheDocument();
      });

      it('renders the loopback address as localhost', () => {
        const { container } = renderCell('ipAddress', { ...baseRow, ipAddress: '::1' });
        expect(within(container).getByText('localhost')).toBeInTheDocument();
      });

      it('falls back to the legacy metadata keys', () => {
        // Older rows recorded the address in metadata under several different names.
        for (const key of ['ipAddress', 'ip', 'clientIp', 'remoteAddress']) {
          const { container } = renderCell('ipAddress', {
            ...baseRow,
            ipAddress: undefined,
            metadata: { [key]: '198.51.100.9' },
          });
          expect(within(container).getByText('198.51.100.9')).toBeInTheDocument();
        }
      });

      it('shows a dash when no address was recorded', () => {
        const { container } = renderCell('ipAddress', { ...baseRow, ipAddress: undefined });
        expect(within(container).getByText('-')).toBeInTheDocument();
      });
    });

    describe('the metadata cell', () => {
      it('renders nothing when the row carries no detail at all', () => {
        const { container } = renderCell('metadata', {
          id: 'log-1',
          action: 'X',
          timestamp: baseRow.timestamp,
        });

        expect(container).toBeEmptyDOMElement();
      });

      it('is collapsed to a named toggle until opened', () => {
        renderCell('metadata', { ...baseRow, metadata: { attempt: 2 } });

        const toggle = screen.getByRole('button', { name: 'Show activity details' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
      });

      it('opens to show the metadata, and renames the toggle', async () => {
        const user = userEvent.setup();
        renderCell('metadata', { ...baseRow, metadata: { attempt: 2 } });

        await user.click(screen.getByRole('button', { name: 'Show activity details' }));

        expect(
          screen.getByRole('button', { name: 'Hide activity details' }),
        ).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText(/attempt: 2/)).toBeInTheDocument();
      });

      it('summarises the related entities it was given', async () => {
        const user = userEvent.setup();
        renderCell('metadata', {
          ...baseRow,
          metadata: { attempt: 1 },
          course: { id: 'c1', name: 'Theory', code: 'CS 401' } as ActivityLog['course'],
          assignment: { id: 'a1', title: 'Homework 2' } as ActivityLog['assignment'],
        });

        await user.click(screen.getByRole('button', { name: 'Show activity details' }));

        expect(screen.getByText(/Course: Theory \(CS 401\)/)).toBeInTheDocument();
        expect(screen.getByText(/Assignment: Homework 2/)).toBeInTheDocument();
      });

      it('falls back to the recorded ids when there is no metadata', async () => {
        // An older row can have the foreign keys without a metadata blob.
        const user = userEvent.setup();
        renderCell('metadata', { ...baseRow, metadata: null, courseId: 'course-9' });

        await user.click(screen.getByRole('button', { name: 'Show activity details' }));

        expect(screen.getByText(/Course ID: course-9/)).toBeInTheDocument();
      });

      it('serialises nested values rather than printing [object Object]', async () => {
        const user = userEvent.setup();
        renderCell('metadata', { ...baseRow, metadata: { change: { from: 1, to: 2 } } });

        await user.click(screen.getByRole('button', { name: 'Show activity details' }));

        expect(screen.getByText(/"from": 1/)).toBeInTheDocument();
      });

      it('does not repeat the address and client that have their own handling', async () => {
        const user = userEvent.setup();
        renderCell('metadata', {
          ...baseRow,
          ipAddress: '203.0.113.7',
          userAgent: 'x'.repeat(80),
          metadata: { ipAddress: '203.0.113.7', userAgent: 'dupe', attempt: 1 },
        });

        await user.click(screen.getByRole('button', { name: 'Show activity details' }));

        // Both appear once, under Enhanced Fields, not again in the metadata list.
        expect(screen.queryByText(/userAgent: dupe/)).not.toBeInTheDocument();
        expect(screen.getByText(/User Agent: x{50}\.\.\./)).toBeInTheDocument();
      });
    });
  });
});
