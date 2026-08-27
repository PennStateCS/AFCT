/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnDef } from '@tanstack/react-table';

import {
  actorName,
  getActivityColumns,
  relatedRecords,
  type ActivityLog,
} from './activity-columns';
import { ACTIVITY_SORT_KEYS } from '@/lib/activity-log-values';

/**
 * The columns are fed straight from `GET /api/courses/[id]/activity`, so this pins what
 * they read off a row and which of them offer sorting. `ActivityCard`'s own test stubs
 * `DataTable`, so nothing else exercises these renderers.
 */
const noop = () => {};
const columns = (onViewDetails: (a: ActivityLog) => void = noop) =>
  getActivityColumns('UTC', 'course-1', onViewDetails) as ColumnDef<ActivityLog>[];

const columnById = (id: string, onViewDetails?: (a: ActivityLog) => void) => {
  const found = columns(onViewDetails).find(
    (c) => c.id === id || (c as { accessorKey?: string }).accessorKey === id,
  );
  if (!found) throw new Error(`No ${id} column`);
  return found;
};

/** Render one column's cell against a server-shaped row. */
const renderCell = (
  id: string,
  row: Partial<ActivityLog>,
  onViewDetails?: (a: ActivityLog) => void,
) => {
  const Cell = columnById(id, onViewDetails).cell as (ctx: unknown) => React.ReactElement;
  // Both shapes a cell may read: the whole row, and the accessor's value for cells (like
  // Time) that take `getValue`.
  return render(
    <>
      {Cell({
        row: { original: row },
        getValue: () => (row as Record<string, unknown>)[id],
      })}
    </>,
  );
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
  /*
   * The verb, from the shared formatter, so this tab and System Logs say the same word for the
   * same entry. It used to title-case the stored value here and upper-case it there, which is
   * how "Grade Updated" and "GRADE UPDATED" ended up being the same event.
   */
  it('shows the shared display verb for the action', () => {
    renderCell('action', baseRow);

    expect(screen.getByText('Graded')).toBeInTheDocument();
  });

  /*
   * Upper-cased in CSS rather than transformed, the same as System Logs. What a screen reader
   * announces and what Copy JSON carries stay in ordinary case.
   */
  it('upper-cases the action for display only', () => {
    renderCell('action', baseRow);

    expect(screen.getByText('Graded')).toHaveClass('uppercase');
  });

  it('reads the assignment title from the relation', () => {
    renderCell('assignmentProblem', {
      ...baseRow,
      assignment: { id: 'a1', title: 'Homework 1' } as ActivityLog['assignment'],
    });

    expect(screen.getByText('Homework 1')).toBeInTheDocument();
  });

  it('falls back to a title recorded in metadata on older events', () => {
    // Older rows recorded only a title, not a relation id. Those still display, but they
    // are exactly the rows an assignment-id filter cannot match.
    renderCell('assignmentProblem', {
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

    it('does not offer sorting on the derived Assignment / Problem column', () => {
      // Its displayed titles come from relations with metadata fallbacks, so the server has
      // no single column to order the whole log by. A sort control here would claim an
      // ordering it silently could not deliver.
      expect(sortableOf('assignmentProblem')).toBe(false);
    });

    it('does not offer sorting on the derived Subject column', () => {
      // Same reason: the phrase is built in the browser out of the action, its metadata and
      // whichever relations came back. There is nothing for the database to order by.
      expect(columnById('summary').enableSorting).toBe(false);
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

    it('renders the category badge', () => {
      const { container } = renderCell('category', baseRow);

      expect(within(container).getByText('GRADE')).toBeInTheDocument();
    });

    it('renders the severity badge', () => {
      const { container } = renderCell('severity', { ...baseRow, severity: 'SECURITY' });

      expect(within(container).getByText('SECURITY')).toBeInTheDocument();
    });

    it('treats a row with no severity as INFO rather than blank', () => {
      // The column has a default in the database, but an older row read through a narrower
      // include can still arrive without one, and an empty cell in a severity column reads
      // as "nothing to see" instead of "ordinary".
      const { container } = renderCell('severity', { ...baseRow, severity: undefined });

      expect(within(container).getByText('INFO')).toBeInTheDocument();
    });

    describe('the user cell', () => {
      it('leads with the surname and shows the address underneath', () => {
        const { container } = renderCell('userLastName', baseRow);

        expect(within(container).getByText('Lovelace, Ada')).toBeInTheDocument();
        expect(within(container).getByText('ada@x.edu')).toBeInTheDocument();
      });

      it('upper-cases the name but not the address', () => {
        const { container } = renderCell('userLastName', baseRow);

        expect(within(container).getByText('Lovelace, Ada')).toHaveClass('uppercase');
        // An address is a value somebody may copy out of the table.
        expect(within(container).getByText('ada@x.edu')).not.toHaveClass('uppercase');
      });

      it('falls back to the address when the account has no name', () => {
        const { container } = renderCell('userLastName', {
          ...baseRow,
          user: {
            id: 'u1',
            email: 'ada@x.edu',
            firstName: null,
            lastName: null,
          } as ActivityLog['user'],
        });

        expect(within(container).getByText('ada@x.edu')).toBeInTheDocument();
      });

      it('shows a dash when the actor is gone', () => {
        // userId is nullable and the relation is SetNull, so a row can outlive its author.
        const { container } = renderCell('userLastName', { ...baseRow, user: null });

        expect(container.textContent).toBe('—');
      });
    });

    describe('the assignment and problem cell', () => {
      it('puts the assignment over the problem', () => {
        const { container } = renderCell('assignmentProblem', {
          ...baseRow,
          assignment: { id: 'a1', title: 'Homework 1' } as ActivityLog['assignment'],
          problem: { id: 'p1', title: 'Even length' } as ActivityLog['problem'],
        });

        expect(container.textContent).toBe('Homework 1Even length');
      });

      it('upper-cases the titles for display only', () => {
        const { container } = renderCell('assignmentProblem', {
          ...baseRow,
          assignment: { id: 'a1', title: 'Homework 1' } as ActivityLog['assignment'],
          problem: { id: 'p1', title: 'Even length' } as ActivityLog['problem'],
        });

        expect(container.firstElementChild).toHaveClass('uppercase');
      });

      it('prefers the problem relation, then metadata', () => {
        const viaMetadata = renderCell('assignmentProblem', {
          ...baseRow,
          metadata: { problemTitle: 'From metadata' },
        });
        expect(within(viaMetadata.container).getByText('From metadata')).toBeInTheDocument();

        const viaLegacyName = renderCell('assignmentProblem', {
          ...baseRow,
          metadata: { problemName: 'Legacy key' },
        });
        expect(within(viaLegacyName.container).getByText('Legacy key')).toBeInTheDocument();
      });

      it('still shows the problem when the entry names no assignment', () => {
        // A problem edited outside an assignment: the top line says so rather than the cell
        // silently sliding the problem up into the assignment's place.
        const { container } = renderCell('assignmentProblem', {
          ...baseRow,
          problem: { id: 'p1', title: 'Even length' } as ActivityLog['problem'],
        });

        expect(container.textContent).toBe('—Even length');
      });

      /**
       * Linked only where the entry recorded an id. An older row can carry a title in its
       * metadata and nothing else, and a link that guesses which record it meant is worse than
       * plain text on an audit trail.
       */
      it('links each title to the record it names', () => {
        const { container } = renderCell('assignmentProblem', {
          ...baseRow,
          assignment: { id: 'a1', title: 'Homework 1' } as ActivityLog['assignment'],
          problem: { id: 'p1', title: 'Even length' } as ActivityLog['problem'],
        });

        expect(within(container).getByRole('link', { name: 'Homework 1' })).toHaveAttribute(
          'href',
          '/dashboard/courses/course-1/a1',
        );
        // Problems have no page of their own; the course's Problems tab is as close as a link
        // can get.
        expect(within(container).getByRole('link', { name: 'Even length' })).toHaveAttribute(
          'href',
          '/dashboard/courses/course-1?tab=problems',
        );
      });

      it('leaves a title recorded only in metadata as plain text', () => {
        const { container } = renderCell('assignmentProblem', {
          ...baseRow,
          metadata: { assignmentTitle: 'Legacy Homework', problemTitle: 'Legacy problem' },
        });

        expect(within(container).queryByRole('link')).toBeNull();
        expect(container.textContent).toContain('Legacy Homework');
      });

      it('shows one dash when the entry is about neither', () => {
        const { container } = renderCell('assignmentProblem', baseRow);

        expect(container.textContent).toBe('—');
      });
    });

    describe('the subject cell', () => {
      it('says what the entry was about, in the words System Logs uses', () => {
        const { container } = renderCell('summary', {
          ...baseRow,
          assignment: { id: 'a1', title: 'Homework 2' } as ActivityLog['assignment'],
        });

        expect(container.textContent).toContain('Homework 2');
      });

      it('shows a dash when the entry describes nothing in particular', () => {
        const { container } = renderCell('summary', { ...baseRow, action: 'LOGIN_SUCCESS' });

        expect(container.textContent).toBe('—');
      });
    });

    describe('the time cell', () => {
      it("puts the date over the time, in the table's timezone", () => {
        const { container } = renderCell('timestamp', {
          ...baseRow,
          timestamp: '2026-03-01T07:05:00.000Z',
        });

        expect(container.textContent).toContain('03/01/26');
        expect(container.textContent).toContain('07:05');
      });

      it('shows a dash rather than an invalid date', () => {
        const { container } = renderCell('timestamp', { ...baseRow, timestamp: '' });

        expect(container.textContent).toBe('\u2014');
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

      it('names the sentinel the submission worker writes', () => {
        // Those entries were made by a background job, not by a request from anywhere.
        const { container } = renderCell('ipAddress', { ...baseRow, ipAddress: 'system' });
        expect(within(container).getByText('System')).toBeInTheDocument();
      });

      it('renders the loopback address as localhost', () => {
        const { container } = renderCell('ipAddress', { ...baseRow, ipAddress: '::1' });
        expect(within(container).getByText('localhost')).toBeInTheDocument();
      });

      it('drops the IPv4-mapped IPv6 prefix', () => {
        const { container } = renderCell('ipAddress', {
          ...baseRow,
          ipAddress: '::ffff:203.0.113.7',
        });
        expect(within(container).getByText('203.0.113.7')).toBeInTheDocument();
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

      /*
       * The second line: an address on its own rarely settles "was that really them", and the
       * same address from a phone rather than the lab machine often does.
       */
      it('names the browser and platform under the address', () => {
        const { container } = renderCell('ipAddress', {
          ...baseRow,
          ipAddress: '203.0.113.7',
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        });

        expect(within(container).getByText('Chrome on Windows')).toBeInTheDocument();
      });

      it('says nothing about the client when the header was not recognised', () => {
        const { container } = renderCell('ipAddress', {
          ...baseRow,
          ipAddress: '203.0.113.7',
          userAgent: 'AFCT-Health-Check/1.0',
        });

        expect(container.textContent).toBe('203.0.113.7');
      });

      it('shows a dash when neither an address nor a client was recorded', () => {
        const { container } = renderCell('ipAddress', { ...baseRow, ipAddress: undefined });
        expect(container.textContent).toBe('—');
      });
    });

    describe('the details button', () => {
      it('names the entry it opens, not just itself', async () => {
        // Every row carries one of these, so a page of buttons all called "View details" is
        // what a screen reader would otherwise read out.
        const onView = vi.fn();
        const user = userEvent.setup();
        renderCell('actions', baseRow, onView);

        const button = screen.getByRole('button', {
          name: /View full log for Graded at 03\/01\/26 12:00/,
        });
        await user.click(button);

        expect(onView).toHaveBeenCalledWith(baseRow);
      });
    });
  });

  /**
   * The mapping the Subject column and the details dialog both read. An older row can carry a
   * foreign key without the relation being included, and an id is worse than a name but far
   * better than silence: it still says the entry was about something.
   */
  describe('the records an entry points at', () => {
    it('names them when the relations came back', () => {
      expect(
        relatedRecords({
          ...baseRow,
          course: { id: 'c1', name: 'Theory', code: 'CS 401' },
          assignment: { id: 'a1', title: 'Homework 2' },
          problem: { id: 'p1', title: 'Even length' },
          submission: {
            id: 's1',
            assignmentProblem: { assignment: { title: 'Homework 2' } },
          },
        } as ActivityLog),
      ).toEqual({
        course: 'CS 401, Theory',
        assignment: 'Homework 2',
        problem: 'Even length',
        submission: 'Homework 2',
      });
    });

    it('falls back to the recorded id when a record was not resolved', () => {
      expect(
        relatedRecords({ ...baseRow, courseId: 'course-9', problemId: 'problem-9' } as ActivityLog),
      ).toMatchObject({ course: 'course-9', problem: 'problem-9', assignment: null });
    });

    it('prefers the name over the id', () => {
      expect(
        relatedRecords({
          ...baseRow,
          courseId: 'course-9',
          course: { id: 'course-9', name: 'Theory', code: 'CS 401' },
        } as ActivityLog).course,
      ).toBe('CS 401, Theory');
    });
  });

  describe('the actor for the details dialog', () => {
    it('is their name where there is one', () => {
      expect(actorName(baseRow as ActivityLog)).toBe('Ada Lovelace');
    });

    it('falls back to the address, then to nobody', () => {
      expect(
        actorName({
          ...baseRow,
          user: { id: 'u1', email: 'ada@x.edu', firstName: null, lastName: null },
        } as ActivityLog),
      ).toBe('ada@x.edu');
      expect(actorName({ ...baseRow, user: null } as ActivityLog)).toBeNull();
    });
  });
});
