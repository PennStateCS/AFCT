import { describe, expect, it } from 'vitest';
import { AssignmentCreateApiSchema } from './assignment';
/**
 * The API schema has to enforce the same date rules as the wizard.
 *
 * They lived on the form only, which reads as "validated" right up until you remember the
 * native client posts to this API directly and never sees the form at all.
 */
describe('AssignmentCreateApiSchema date rules', () => {
  const base = { title: 'HW1', dueDate: '2026-03-10T00:00:00.000Z' };
  const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
    r.success ? [] : (r.error?.issues.map((i) => i.message) ?? []);

  it('accepts a schedule that runs in order', () => {
    const r = AssignmentCreateApiSchema.safeParse({
      ...base,
      unlockAt: '2026-03-01T00:00:00.000Z',
      allowLateSubmissions: true,
      lateCutoff: '2026-03-12T00:00:00.000Z',
    });

    expect(r.success).toBe(true);
  });

  it('refuses an assignment that unlocks after it is due', () => {
    const r = AssignmentCreateApiSchema.safeParse({
      ...base,
      unlockAt: '2026-03-20T00:00:00.000Z',
    });

    expect(messages(r).join(' ')).toMatch(/on or before the due date/);
  });

  it('refuses a late cutoff that falls before the due date', () => {
    const r = AssignmentCreateApiSchema.safeParse({
      ...base,
      allowLateSubmissions: true,
      lateCutoff: '2026-03-01T00:00:00.000Z',
    });

    expect(messages(r).join(' ')).toMatch(/on or after the due date/);
  });

  it('refuses a cutoff when late submissions are off', () => {
    const r = AssignmentCreateApiSchema.safeParse({
      ...base,
      allowLateSubmissions: false,
      lateCutoff: '2026-03-12T00:00:00.000Z',
    });

    expect(messages(r).join(' ')).toMatch(/enable late submissions/);
  });

  /** null is how the API says "not set"; the form says '' and both must pass. */
  it('treats null dates as not set rather than as an error', () => {
    const r = AssignmentCreateApiSchema.safeParse({ ...base, unlockAt: null, lateCutoff: null });

    expect(r.success).toBe(true);
  });
});
