import { describe, it, expect } from 'vitest';
import { sliceProgress } from './updates';

describe('sliceProgress', () => {
  it('returns all lines from cursor 0 and the next cursor', () => {
    const r = sliceProgress('a\nb\nc\n', 0);
    expect(r.lines).toEqual(['a', 'b', 'c']);
    expect(r.nextCursor).toBe(3);
  });

  it('returns only lines past the cursor', () => {
    const r = sliceProgress('a\nb\nc\nd\n', 2);
    expect(r.lines).toEqual(['c', 'd']);
    expect(r.nextCursor).toBe(4);
  });

  it('yields nothing when the cursor is already at the end', () => {
    const r = sliceProgress('a\nb\n', 2);
    expect(r.lines).toEqual([]);
    expect(r.nextCursor).toBe(2);
  });

  it('handles content with no trailing newline', () => {
    const r = sliceProgress('a\nb', 0);
    expect(r.lines).toEqual(['a', 'b']);
    expect(r.nextCursor).toBe(2);
  });

  it('resends from the top when the log was truncated below the cursor', () => {
    // The updater resets progress.log each upgrade; a stale cursor must not skip lines.
    const r = sliceProgress('x\ny\n', 5);
    expect(r.lines).toEqual(['x', 'y']);
    expect(r.nextCursor).toBe(2);
  });

  it('treats an empty log as no lines', () => {
    const r = sliceProgress('', 0);
    expect(r.lines).toEqual([]);
    expect(r.nextCursor).toBe(0);
  });

  it('flags a truncation so the reader replaces rather than appends', () => {
    // The whole point of the flag: a new run emptied the log, so the lines coming back are
    // the new run's. A reader that appends them keeps the previous run's output on screen,
    // which is exactly what the Updates tab did when an upgrade followed a self-update.
    const r = sliceProgress('new-1\nnew-2\n', 7);

    expect(r.reset).toBe(true);
    expect(r.lines).toEqual(['new-1', 'new-2']);
  });

  it('does not flag ordinary reads, so normal streaming still appends', () => {
    expect(sliceProgress('a\nb\nc\n', 0).reset).toBe(false);
    expect(sliceProgress('a\nb\nc\n', 2).reset).toBe(false);
    // Cursor exactly at the end is not a truncation, just nothing new.
    expect(sliceProgress('a\nb\n', 2).reset).toBe(false);
  });
});
