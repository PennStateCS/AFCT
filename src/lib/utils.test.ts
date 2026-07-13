import { describe, it, expect } from 'vitest';
import { cn, truncate } from './utils';

describe('utils', () => {
  describe('cn', () => {
    it('should merge single class name', () => {
      expect(cn('foo')).toBe('foo');
    });

    it('should merge multiple class names', () => {
      expect(cn('foo', 'bar', 'baz')).toBe('foo bar baz');
    });

    it('should handle conditional classes', () => {
      expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz');
      expect(cn('foo', true && 'bar', 'baz')).toBe('foo bar baz');
    });

    it('should handle undefined and null values', () => {
      expect(cn('foo', undefined, 'bar', null)).toBe('foo bar');
    });

    it('should merge conflicting Tailwind classes (twMerge)', () => {
      // twMerge should handle Tailwind conflicts by keeping the last one
      expect(cn('px-2', 'px-4')).toBe('px-4');
      expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
    });

    it('should handle array of class names (clsx)', () => {
      expect(cn(['foo', 'bar'])).toBe('foo bar');
      expect(cn(['foo', false && 'bar', 'baz'])).toBe('foo baz');
    });

    it('should handle object with boolean values (clsx)', () => {
      expect(cn({ foo: true, bar: false, baz: true })).toBe('foo baz');
    });

    it('should combine multiple input types', () => {
      expect(cn('foo', ['bar', 'baz'], { qux: true, quux: false })).toBe('foo bar baz qux');
    });

    it('should handle empty inputs', () => {
      expect(cn()).toBe('');
      expect(cn('')).toBe('');
      expect(cn(undefined, null, false)).toBe('');
    });

    it('should merge responsive Tailwind classes', () => {
      expect(cn('sm:px-2', 'md:px-4', 'lg:px-6')).toBe('sm:px-2 md:px-4 lg:px-6');
    });

    it('should merge hover and focus states', () => {
      expect(cn('hover:bg-blue-500', 'hover:bg-red-500')).toBe('hover:bg-red-500');
    });

    it('should preserve different variant modifiers', () => {
      expect(cn('bg-blue-500', 'hover:bg-red-500', 'dark:bg-green-500')).toBe(
        'bg-blue-500 hover:bg-red-500 dark:bg-green-500',
      );
    });

    it('should handle complex real-world component classes', () => {
      const result = cn(
        'rounded-md border border-input bg-background px-3 py-2',
        'text-sm ring-offset-background',
        'focus-visible:outline-none focus-visible:ring-2',
        { 'opacity-50 cursor-not-allowed': false },
      );

      expect(result).toContain('rounded-md');
      expect(result).toContain('border');
      expect(result).toContain('px-3');
      expect(result).not.toContain('opacity-50');
    });

    it('should merge same property with different modifiers correctly', () => {
      // Both should be kept since they have different modifiers
      expect(cn('dark:text-white', 'text-black')).toBe('dark:text-white text-black');
    });

    it('should handle whitespace and duplicate classes', () => {
      // clsx trims whitespace but doesn't deduplicate non-conflicting classes
      expect(cn('  foo  ', 'bar', 'foo')).toBe('foo bar foo');
    });

    it('should work with nested arrays and objects', () => {
      expect(cn('base', ['array1', ['nested-array', { 'conditional-class': true }]])).toBe(
        'base array1 nested-array conditional-class',
      );
    });
  });

  describe('truncate', () => {
    it('returns short strings unchanged', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('returns a string of exactly max unchanged', () => {
      expect(truncate('abcde', 5)).toBe('abcde');
    });

    it('truncates and appends an ellipsis when over the limit', () => {
      expect(truncate('abcdef', 5)).toBe('abcde…');
    });

    it('adds the ellipsis for a string of exactly max + 1 (the old off-by-one)', () => {
      // The former `substring(0, 46) + (len > 47 ? '…' : '')` dropped this char silently.
      expect(truncate('abcdef', 5)).toBe('abcde…');
      expect(truncate('123456', 5)).toBe('12345…');
    });

    it('handles empty strings and zero max', () => {
      expect(truncate('', 5)).toBe('');
      expect(truncate('abc', 0)).toBe('…');
    });

    it('returns the value unchanged for a negative max rather than throwing', () => {
      expect(truncate('abc', -1)).toBe('abc');
    });
  });
});
