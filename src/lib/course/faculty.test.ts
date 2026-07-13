import { describe, it, expect } from 'vitest';
import { diffFacultyRoster } from './faculty';

describe('diffFacultyRoster', () => {
  it('adds members not on the roster', () => {
    const diff = diffFacultyRoster([], ['u1', 'u2']);
    expect(diff.toAdd).toEqual(['u1', 'u2']);
    expect(diff.toPromote).toEqual([]);
    expect(diff.toRemove).toEqual([]);
  });

  it('promotes existing non-faculty members', () => {
    const diff = diffFacultyRoster([{ userId: 'u1', role: 'TA' }], ['u1']);
    expect(diff.toPromote).toEqual(['u1']);
    expect(diff.toAdd).toEqual([]);
    expect(diff.toRemove).toEqual([]);
  });

  it('leaves already-faculty members untouched', () => {
    const diff = diffFacultyRoster([{ userId: 'u1', role: 'FACULTY' }], ['u1']);
    expect(diff).toEqual({ toAdd: [], toPromote: [], toRemove: [] });
  });

  it('removes faculty no longer desired', () => {
    const diff = diffFacultyRoster(
      [
        { userId: 'u1', role: 'FACULTY' },
        { userId: 'u2', role: 'FACULTY' },
      ],
      ['u1'],
    );
    expect(diff.toRemove).toEqual(['u2']);
  });

  it('handles a mixed add/promote/remove set', () => {
    const diff = diffFacultyRoster(
      [
        { userId: 'keep', role: 'FACULTY' },
        { userId: 'promote', role: 'TA' },
        { userId: 'drop', role: 'FACULTY' },
        { userId: 'student', role: 'STUDENT' },
      ],
      ['keep', 'promote', 'new'],
    );
    expect(diff.toAdd).toEqual(['new']);
    expect(diff.toPromote).toEqual(['promote']);
    expect(diff.toRemove).toEqual(['drop']);
  });

  it('does not remove a non-faculty member simply because they are omitted', () => {
    const diff = diffFacultyRoster([{ userId: 'student', role: 'STUDENT' }], []);
    expect(diff.toRemove).toEqual([]);
  });
});
