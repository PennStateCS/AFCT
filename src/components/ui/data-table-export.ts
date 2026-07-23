import type { Row, Column } from '@tanstack/react-table';
import { escapeCsvCell } from '@/lib/csv';

/**
 * Turn table rows into a CSV string. Split out from the DataTable component so the
 * formatting rules can be unit-tested directly, instead of only through a rendered
 * table with `URL.createObjectURL` and `document.createElement` stubbed out.
 *
 * Every cell goes through escapeCsvCell: it quotes (so embedded commas/newlines are
 * safe) AND neutralizes leading =, +, -, @, tab and CR, which a spreadsheet would
 * otherwise execute as a formula. Table values include user-controlled text such as
 * student names and course titles, so quoting alone is not enough.
 */
export function buildTableCsv<TData>(
  rows: Row<TData>[],
  visibleColumns: Column<TData, unknown>[],
): string {
  const headers = visibleColumns.map((col) => escapeCsvCell(col.id));
  const csvRows = [headers.join(',')];

  rows.forEach((row) => {
    const values = row
      .getVisibleCells()
      .filter((cell) => visibleColumns.includes(cell.column))
      .map((cell) => escapeCsvCell(cell.getValue()));
    csvRows.push(values.join(','));
  });

  return csvRows.join('\n');
}

/** Hand a CSV string to the browser as a download. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  link.click();
  URL.revokeObjectURL(url);
}
