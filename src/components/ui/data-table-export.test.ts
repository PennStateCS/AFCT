import { describe, expect, it } from 'vitest';
import type { Column, Row } from '@tanstack/react-table';
import { buildTableCsv } from './data-table-export';

type Fake = Record<string, unknown>;

/**
 * Minimal stand-ins for the bits of Row/Column that buildTableCsv touches. Splitting
 * the CSV logic out of the component is what lets these be plain objects instead of a
 * rendered table with URL.createObjectURL stubbed.
 */
const column = (id: string) => ({ id }) as Column<Fake, unknown>;

const row = (cols: Column<Fake, unknown>[], values: unknown[]) =>
  ({
    getVisibleCells: () => cols.map((c, i) => ({ column: c, getValue: () => values[i] })),
  }) as unknown as Row<Fake>;

describe('buildTableCsv', () => {
  it('writes a header row followed by one line per row', () => {
    const cols = [column('name'), column('role')];
    const rows = [row(cols, ['Alice', 'Admin']), row(cols, ['Bob', 'Student'])];

    expect(buildTableCsv(rows, cols).split('\n')).toEqual([
      '"name","role"',
      '"Alice","Admin"',
      '"Bob","Student"',
    ]);
  });

  it('quotes values containing commas so the row keeps its shape', () => {
    const cols = [column('name')];
    const csv = buildTableCsv([row(cols, ['Doe, Jane'])], cols);

    expect(csv.split('\n')).toHaveLength(2);
    expect(csv).toContain('"Doe, Jane"');
  });

  it('neutralizes spreadsheet formulas in user-controlled text', () => {
    const cols = [column('name')];
    const csv = buildTableCsv([row(cols, ['=SUM(A1:A9)'])], cols);

    // Must not survive as a leading "=", which Excel/Sheets would execute.
    expect(csv).not.toMatch(/\n"=/);
  });

  it('skips columns that are not in the visible set', () => {
    const cols = [column('name'), column('role')];
    const csv = buildTableCsv([row(cols, ['Alice', 'Admin'])], [cols[0]]);

    expect(csv).toBe('"name"\n"Alice"');
  });

  it('emits only the header when there are no rows', () => {
    expect(buildTableCsv([], [column('name')])).toBe('"name"');
  });
});
