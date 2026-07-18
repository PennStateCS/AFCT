import { describe, expect, it } from 'vitest';
import { resolveOverrideFields, type OverrideBaseFields } from './assignment-overrides';

const base: OverrideBaseFields = {
  unlockAt: null,
  dueDate: new Date('2026-01-10T23:59:00.000Z'),
  lateCutoff: null,
  allowLateSubmissions: false,
};

describe('resolveOverrideFields', () => {
  it('sets a provided due date (UTC end of day) and leaves the rest inherited', () => {
    const res = resolveOverrideFields({
      incoming: { dueDate: '2026-01-20' },
      existing: null,
      base,
      timezone: 'UTC',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.fields.dueDate?.toISOString()).toBe('2026-01-20T23:59:00.000Z');
      expect(res.fields.unlockAt).toBeNull();
      expect(res.fields.allowLateSubmissions).toBeNull();
    }
  });

  it('rejects an override that changes nothing', () => {
    const res = resolveOverrideFields({ incoming: {}, existing: null, base, timezone: 'UTC' });
    expect(res.ok).toBe(false);
  });

  it('rejects an available-from after the effective due date', () => {
    const res = resolveOverrideFields({
      incoming: { unlockAt: '2026-01-20' },
      existing: null,
      base,
      timezone: 'UTC',
    });
    expect(res.ok).toBe(false);
  });

  it('rejects a late cutoff before the effective due date', () => {
    const res = resolveOverrideFields({
      incoming: { allowLateSubmissions: true, lateCutoff: '2026-01-05' },
      existing: null,
      base,
      timezone: 'UTC',
    });
    expect(res.ok).toBe(false);
  });

  it('keeps existing fields when omitted on update', () => {
    const existing = {
      unlockAt: null,
      dueDate: new Date('2026-01-15T23:59:00.000Z'),
      lateCutoff: null,
      allowLateSubmissions: null,
    };
    const res = resolveOverrideFields({
      incoming: { allowLateSubmissions: true, lateCutoff: '2026-01-20' },
      existing,
      base,
      timezone: 'UTC',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      // dueDate omitted -> keeps the existing override value
      expect(res.fields.dueDate?.toISOString()).toBe('2026-01-15T23:59:00.000Z');
      expect(res.fields.allowLateSubmissions).toBe(true);
    }
  });
});
