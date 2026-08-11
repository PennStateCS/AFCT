import { describe, expect, it } from 'vitest';
import { diffFields } from './activity';

/**
 * What changed, as old and new side by side.
 *
 * The gap this closes: an update recorded which fields moved and what they are now, so "who
 * changed the due date" was answerable and "from when" was not. Both halves are what makes a
 * log usable for accountability, and for anybody debugging a complaint about a deadline.
 */

describe('recording a change', () => {
  it('keeps both the old and the new value', () => {
    const changes = diffFields({ title: 'Old' }, { title: 'New' });

    expect(changes).toEqual({ title: { from: 'Old', to: 'New' } });
  });

  // A save that touched nothing should say nothing, or every entry looks like a change.
  it('ignores a field that did not move', () => {
    expect(diffFields({ title: 'Same' }, { title: 'Same' })).toEqual({});
  });

  it('only looks at the fields being written', () => {
    const changes = diffFields({ title: 'A', points: 10 }, { title: 'B' });

    expect(Object.keys(changes)).toEqual(['title']);
  });

  /**
   * Dates are compared by value. Two Date objects for the same instant are different objects,
   * so identity comparison would report a change on every save.
   */
  it('does not report a date that stayed the same', () => {
    const when = '2026-08-24T00:00:00.000Z';

    expect(diffFields({ dueDate: new Date(when) }, { dueDate: new Date(when) })).toEqual({});
  });

  it('records a date that really moved, readably', () => {
    const changes = diffFields(
      { dueDate: new Date('2026-08-24T00:00:00.000Z') },
      { dueDate: new Date('2026-09-01T00:00:00.000Z') },
    );

    expect(changes.dueDate).toEqual({
      from: '2026-08-24T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
    });
  });

  // Null and absent mean the same thing to a reader, and treating them apart makes every
  // first-time value look like a change from something.
  it('treats missing and null alike', () => {
    expect(diffFields({}, { lateCutoff: null })).toEqual({});
    expect(diffFields({ lateCutoff: null }, { lateCutoff: null })).toEqual({});
  });

  it('records setting a value that was not there', () => {
    expect(diffFields({ lateCutoff: null }, { lateCutoff: '2026-09-01' })).toEqual({
      lateCutoff: { from: null, to: '2026-09-01' },
    });
  });

  it('records clearing one', () => {
    expect(diffFields({ lateCutoff: '2026-09-01' }, { lateCutoff: null })).toEqual({
      lateCutoff: { from: '2026-09-01', to: null },
    });
  });
});
