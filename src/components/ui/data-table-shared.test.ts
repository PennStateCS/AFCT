import { describe, expect, it } from 'vitest';
import { responsiveClass, rowRangeLabel } from './data-table-shared';

describe('responsiveClass', () => {
  // Priority 1 and "no priority" are always visible; higher priorities drop at
  // progressively wider breakpoints, all above the 640px table->cards cutoff so the
  // table condenses through several stages first.
  it('keeps priority 1 and unset columns always visible', () => {
    expect(responsiveClass(1)).toBe('');
    expect(responsiveClass(undefined)).toBe('');
  });

  it('hides higher priorities at progressively wider breakpoints', () => {
    expect(responsiveClass(2)).toBe('hidden md:table-cell');
    expect(responsiveClass(3)).toBe('hidden lg:table-cell');
    expect(responsiveClass(4)).toBe('hidden xl:table-cell');
  });
});

describe('rowRangeLabel', () => {
  /**
   * A server table keeps the previous page's rows on screen while the next page loads, so for
   * that moment the count on screen belongs to one page and the index to another. Unclamped,
   * the last page read "Showing 1,951-2,000 of 1,956" and the footer's live region said it.
   */
  it('never runs past the total while a page is still loading', () => {
    expect(rowRangeLabel({ firstRow: 1951, rowsOnPage: 50, total: 1956 })).toBe(
      'Showing 1,951-1,956 of 1,956 records',
    );
  });

  it('says which rows these are and how many there are', () => {
    expect(rowRangeLabel({ firstRow: 1, rowsOnPage: 10, total: 2206 })).toBe(
      'Showing 1-10 of 2,206 records',
    );
  });

  /** The reason the rows on screen are counted rather than derived from the page size. */
  it('does not run past the end on the last page', () => {
    expect(rowRangeLabel({ firstRow: 2201, rowsOnPage: 6, total: 2206 })).toBe(
      'Showing 2,201-2,206 of 2,206 records',
    );
  });

  it('reads as one row rather than a range when there is only one', () => {
    expect(rowRangeLabel({ firstRow: 7, rowsOnPage: 1, total: 9 })).toBe('Showing 7 of 9 records');
    expect(rowRangeLabel({ firstRow: 1, rowsOnPage: 1, total: 1 })).toBe('Showing 1 of 1 record');
  });

  it('says what a search is hiding, which a bare count would not', () => {
    expect(rowRangeLabel({ firstRow: 1, rowsOnPage: 10, total: 12, filteredFrom: 2206 })).toBe(
      'Showing 1-10 of 12 records, filtered from 2,206',
    );
  });

  it('has something sensible to say when there is nothing', () => {
    expect(rowRangeLabel({ firstRow: 0, rowsOnPage: 0, total: 0 })).toBe('No records');
    expect(rowRangeLabel({ firstRow: 0, rowsOnPage: 0, total: 0, filteredFrom: 40 })).toBe(
      'No matching records',
    );
  });
});
