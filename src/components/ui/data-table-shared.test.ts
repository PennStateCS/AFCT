import { describe, expect, it } from 'vitest';
import { responsiveClass } from './data-table-shared';

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
