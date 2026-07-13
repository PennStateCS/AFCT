import { describe, it, expect, vi } from 'vitest';
import { countByAssignment, studentsWithSubmissions } from './aggregates';

describe('countByAssignment', () => {
  it('returns an empty map for no assignments without touching the delegate', async () => {
    const countOne = vi.fn();
    const map = await countByAssignment({}, [], countOne);
    expect(map.size).toBe(0);
    expect(countOne).not.toHaveBeenCalled();
  });

  it('uses groupBy when available', async () => {
    const delegate = {
      groupBy: vi.fn().mockResolvedValue([
        { assignmentId: 'a1', _count: { _all: 3 } },
        { assignmentId: 'a2', _count: { _all: 5 } },
      ]),
    };
    const map = await countByAssignment(delegate, ['a1', 'a2'], vi.fn());
    expect(map.get('a1')).toBe(3);
    expect(map.get('a2')).toBe(5);
    expect(delegate.groupBy).toHaveBeenCalledOnce();
  });

  it('falls back to findMany, counting one per row', async () => {
    const delegate = {
      findMany: vi
        .fn()
        .mockResolvedValue([{ assignmentId: 'a1' }, { assignmentId: 'a1' }, { assignmentId: 'a2' }]),
    };
    const map = await countByAssignment(delegate, ['a1', 'a2'], vi.fn());
    expect(map.get('a1')).toBe(2);
    expect(map.get('a2')).toBe(1);
  });

  it('falls back to a per-assignment count when the delegate has neither', async () => {
    const countOne = vi.fn(async (id: string) => (id === 'a1' ? 4 : 0));
    const map = await countByAssignment({}, ['a1', 'a2'], countOne);
    expect(map.get('a1')).toBe(4);
    expect(map.get('a2')).toBe(0);
    expect(countOne).toHaveBeenCalledTimes(2);
  });
});

describe('studentsWithSubmissions', () => {
  it('returns an empty set when there are no students or assignments', async () => {
    const has = vi.fn();
    expect((await studentsWithSubmissions({}, [], ['a1'], has)).size).toBe(0);
    expect((await studentsWithSubmissions({}, ['s1'], [], has)).size).toBe(0);
    expect(has).not.toHaveBeenCalled();
  });

  it('uses groupBy rows when available', async () => {
    const delegate = { groupBy: vi.fn().mockResolvedValue([{ studentId: 's1' }, { studentId: 's2' }]) };
    const set = await studentsWithSubmissions(delegate, ['s1', 's2', 's3'], ['a1'], vi.fn());
    expect([...set].sort()).toEqual(['s1', 's2']);
  });

  it('falls back to a per-student existence check', async () => {
    const has = vi.fn(async (studentId: string) => studentId === 's1');
    const set = await studentsWithSubmissions({}, ['s1', 's2'], ['a1'], has);
    expect(set.has('s1')).toBe(true);
    expect(set.has('s2')).toBe(false);
    expect(has).toHaveBeenCalledTimes(2);
  });
});
