import type { FilterFn, Column as TanstackColumn } from '@tanstack/react-table';

export type ColumnAlign = 'left' | 'center' | 'right';

// Extend @tanstack/react-table's ColumnMeta so `columnDef.meta.priority` / `.align`
// are typed everywhere; this augmentation is the single source of truth (there is no
// separate local interface to keep in sync).
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    priority?: number;
    align?: ColumnAlign;
    /** Opt this column into a faceted value filter (multi-select of its values). */
    filterVariant?: 'multiselect';
    /** Label for the filter button / search scope / mobile card (defaults to the
     *  string header, else the column id). */
    filterLabel?: string;
    /** Fixed, friendly options for the value filter. Without it, the distinct
     *  values found in the data are used (good for plain string columns; set this
     *  for boolean/coded columns so the picker shows real labels). */
    filterOptions?: { label: string; value: string }[];
    /** Split this column's options across several headings in the Filters popover.
     *  Use it when the values are all one dimension (so they still OR together, and no
     *  combination can be impossible) but read as separate lists to the user, e.g. the
     *  queue's Status (pending/processing/failed) and Submission (correct/incorrect).
     *  Values that need to AND belong in separate columns instead. Wins over
     *  `filterOptions`. */
    filterSections?: { label: string; options: { label: string; value: string }[] }[];
    /** Hide this column from the stacked mobile card view. */
    mobileHidden?: boolean;
    /**
     * Where this column's cell goes on a stacked mobile card. Only the `actions` column
     * is read for it.
     *
     * `corner` (the default) is the ordinary case: one icon-only overflow menu, which
     * belongs in the card's top-right where it reads as belonging to the record.
     *
     * `footer` is for an action cell that is more than that: two text buttons, a
     * confirm-and-cancel pair, anything wider than an icon. Those cannot sit in a 36px
     * corner without truncating, so they keep a divider and a row of their own under the
     * card's fields.
     *
     * Declared rather than detected. Working out whether a rendered cell "is a dropdown"
     * from its children or its icons breaks the first time a cell is wrapped in anything,
     * and it breaks silently.
     */
    mobileActionPlacement?: 'corner' | 'footer';
    /** Keep this column's cell on one line. Cells wrap by default; set this for values
     *  that must not break (dates, counts, short codes, action buttons). */
    nowrap?: boolean;
    /** Render this column's body cell as a row header (`<th scope="row">`) instead of a
     *  plain `<td>`, so assistive tech associates the other cells in the row with it.
     *  Use for the identity column of a matrix (e.g. the student in the gradebook).
     *  At most one column per table should set this. */
    rowHeader?: boolean;
  }
}

/**
 * Matches a row when the column's value is one of the selected values. An empty /
 * missing selection is a no-op (row passes). Values are compared as strings so
 * boolean and numeric columns work with the string option values the UI stores.
 */
export const multiSelectFilter: FilterFn<unknown> = (row, columnId, filterValue) => {
  if (!Array.isArray(filterValue) || filterValue.length === 0) return true;
  return filterValue.includes(String(row.getValue(columnId)));
};

export const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 75, 100];

/** Tailwind text-alignment class for a column's `align` meta. */
export const alignTextClass = (align: ColumnAlign | undefined): string =>
  align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : '';

/** Flexbox justification matching a column's `align` meta. */
export const alignFlexClass = (align: ColumnAlign | undefined): string =>
  align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : '';

/** aria-sort value for a header cell given whether it's sortable and its sort state. */
export const ariaSort = (
  canSort: boolean,
  sorted: false | 'asc' | 'desc',
): 'ascending' | 'descending' | 'none' | undefined => {
  if (!canSort) return undefined;
  if (sorted === 'asc') return 'ascending';
  if (sorted === 'desc') return 'descending';
  return 'none';
};

/**
 * Responsive visibility class for a column's `priority` meta (higher = hidden sooner).
 * The thresholds sit above the table→cards cutoff (640px, see `useStackedView`) so the
 * table condenses through several stages before it becomes cards: priority 4 drops
 * below xl, 3 below lg, 2 below md, and priority 1 (or unset) always shows. Every table
 * must therefore keep at least one priority-1 column, or its narrowest stage is blank.
 */
export const responsiveClass = (priority: number | undefined): string => {
  if (priority === 2) return 'hidden md:table-cell';
  if (priority === 3) return 'hidden lg:table-cell';
  if (priority === 4) return 'hidden xl:table-cell';
  return '';
};

/** Friendly label for a column: its `filterLabel` meta, else its string header, else id. */
export const columnLabel = <TData>(column: TanstackColumn<TData, unknown>): string => {
  const label = column.columnDef.meta?.filterLabel;
  if (label && label.trim().length > 0) return label;
  const header = column.columnDef.header;
  if (typeof header === 'string' && header.trim().length > 0) return header;
  return column.id;
};

/**
 * "Showing 1-10 of 2,206 records", the line under a table.
 *
 * A bare total answers "how much is there" and leaves "where am I" to be worked out from the
 * page number and the page size, which is arithmetic nobody should be doing to read a table.
 * The range says both.
 *
 * Numbers are grouped in the viewer's locale, like the dates elsewhere: a bare 1204393 has to
 * be counted digit by digit before it means anything.
 */
export function rowRangeLabel(opts: {
  /** 1-based position of the first row on screen; 0 when there are none. */
  firstRow: number;
  /** How many rows are actually on screen, which is what makes the last page right. */
  rowsOnPage: number;
  /** Rows after any filter. */
  total: number;
  /** The whole set, when a filter is narrowing it. Omitted when nothing is being hidden. */
  filteredFrom?: number;
}): string {
  const count = (n: number) => n.toLocaleString();
  const noun = opts.total === 1 ? 'record' : 'records';

  if (opts.total === 0 || opts.rowsOnPage === 0) {
    return opts.filteredFrom !== undefined ? 'No matching records' : 'No records';
  }

  // Clamped to the total: a server table keeps the previous page's rows on screen while the
  // next one loads, so between the click and the response the count on screen belongs to one
  // page and the index to another. Unclamped, the last page reads "Showing 1,951-2,000 of
  // 1,956" for that moment, and the footer's live region says it out loud.
  const last = Math.min(opts.firstRow + opts.rowsOnPage - 1, opts.total);
  // "Showing 7 of 7" rather than "Showing 7-7 of 7", which reads as a typo.
  const range =
    opts.firstRow === last ? `${count(opts.firstRow)}` : `${count(opts.firstRow)}-${count(last)}`;
  const shown = `Showing ${range} of ${count(opts.total)} ${noun}`;

  return opts.filteredFrom !== undefined
    ? `${shown}, filtered from ${count(opts.filteredFrom)}`
    : shown;
}
