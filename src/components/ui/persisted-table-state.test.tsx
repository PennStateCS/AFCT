/** @vitest-environment jsdom */

import React from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';

import { DataTable } from './data-table';
import { usePersistentPageSize } from './use-persistent-page-size';

/**
 * What a table leaves in a browser's localStorage, asserted as a contract.
 *
 * Faculty accumulate these: which columns they hide on the gradebook, how many rows they read
 * the roster at. None of it is on a server, so anything that changes a key or the shape of a
 * value silently resets a preference somebody set months ago, on a screen nobody will think to
 * check. The hooks are covered elsewhere for behaviour; what is pinned here is the wire format,
 * because that is what an upgrade can move without any test noticing.
 *
 * The literal strings matter. `storageKey` is used verbatim for visibility and suffixed for
 * page size, and both appear here spelled out rather than built from the same template the
 * code uses, so a change to that template shows up as a failure instead of agreeing with
 * itself.
 */

type Row = { id: string; name: string; role: string };

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name', meta: { priority: 1 } },
  { accessorKey: 'role', header: 'Role', meta: { priority: 2 } },
];

const data: Row[] = Array.from({ length: 30 }, (_, i) => ({
  id: String(i),
  name: `Person ${i}`,
  role: i % 2 === 0 ? 'Student' : 'TA',
}));

const STORAGE_KEY = 'afct.test-table';

// Radix's Select reaches for browser APIs jsdom does not implement. Same shims as
// SelectField.test.tsx.
beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const globalAny = globalThis as Record<string, unknown>;
  if (!globalAny.ResizeObserver) globalAny.ResizeObserver = ResizeObserverMock;
  if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => {};
  if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => {};
  if (!HTMLElement.prototype.releasePointerCapture)
    HTMLElement.prototype.releasePointerCapture = () => {};
  if (!HTMLElement.prototype.hasPointerCapture)
    HTMLElement.prototype.hasPointerCapture = () => false;
});

describe('what a table persists', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes column visibility under the storage key itself', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={data} storageKey={STORAGE_KEY} />);

    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Role' }));

    const saved = localStorage.getItem(STORAGE_KEY);
    expect(saved).not.toBeNull();

    // A flat map of column id to boolean. The ids are the accessor keys, which is what makes
    // a saved layout survive a column being reordered or another one being added.
    const parsed = JSON.parse(saved!) as Record<string, boolean>;
    expect(parsed).toMatchObject({ role: false });
    for (const value of Object.values(parsed)) {
      expect(typeof value).toBe('boolean');
    }
  });

  /*
   * Straight at the hook rather than through the Rows-per-page control. The control is a
   * Radix Select, and driving its portal in jsdom tests Radix; the wire format is the thing
   * under contract, and the read-back test below is what proves the table uses this key.
   */
  it('writes the page size under the storage key plus "-page-size"', () => {
    const { result } = renderHook(() => usePersistentPageSize(STORAGE_KEY, 10));

    act(() => result.current[1](20));

    // A bare integer as a string, not JSON, not an object. The reader parses with Number()
    // and rejects anything non-integer, so a change of shape here reads as "no preference".
    expect(localStorage.getItem(`${STORAGE_KEY}-page-size`)).toBe('20');
  });

  it('reads back what a previous visit wrote', async () => {
    // The half that matters to the person: they set it last week, and it is still set.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ role: false }));
    localStorage.setItem(`${STORAGE_KEY}-page-size`, '20');

    render(<DataTable columns={columns} data={data} storageKey={STORAGE_KEY} />);

    expect(await screen.findByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Role' })).not.toBeInTheDocument();
    // 20 of the 30 rows, so the page indicator is the readable proof the size was adopted.
    // More than one match: the visible footer label and the live region that announces it.
    expect(await screen.findAllByText(/Showing 1-20 of 30/)).not.toHaveLength(0);
  });

  it('ignores a stored page size that is not a sane row count', async () => {
    localStorage.setItem(`${STORAGE_KEY}-page-size`, 'lots');

    render(<DataTable columns={columns} data={data} storageKey={STORAGE_KEY} />);

    // Falls back to the default rather than showing nothing or throwing. Hand-edited storage
    // and values left over from an older set of options both land here.
    expect(await screen.findAllByText(/Showing 1-10 of 30/)).not.toHaveLength(0);
  });
});
