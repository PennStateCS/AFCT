import { describe, it, expect } from 'vitest';
import { ProblemCreateApiSchema } from './problem';

/**
 * The problem create/update routes take multipart form data (they carry the solution file), so
 * every field arrives as a string. These cover the rich description surviving that trip.
 */
describe('ProblemCreateApiSchema descriptionJson (multipart)', () => {
  const base = { title: 'Pumping lemma', type: 'FA' as const };
  const envelope = {
    version: 1,
    document: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prove it.' }] }],
    },
  };

  it('parses a JSON string into the envelope', () => {
    const parsed = ProblemCreateApiSchema.parse({
      ...base,
      descriptionJson: JSON.stringify(envelope),
    });
    expect(parsed.descriptionJson).toEqual(envelope);
  });

  it('treats a blank value as absent, so the write stays plain text', () => {
    expect(ProblemCreateApiSchema.parse({ ...base, descriptionJson: '' }).descriptionJson).toBeUndefined();
  });

  it('accepts an absent field', () => {
    expect(ProblemCreateApiSchema.parse(base).descriptionJson).toBeUndefined();
  });

  it('rejects a string that is not JSON', () => {
    expect(ProblemCreateApiSchema.safeParse({ ...base, descriptionJson: 'not json' }).success).toBe(
      false,
    );
  });

  it('rejects a document with an unsupported node', () => {
    const hostile = { version: 1, document: { type: 'doc', content: [{ type: 'image' }] } };
    expect(
      ProblemCreateApiSchema.safeParse({ ...base, descriptionJson: JSON.stringify(hostile) })
        .success,
    ).toBe(false);
  });

  it('still accepts an object body (a JSON request rather than form data)', () => {
    expect(
      ProblemCreateApiSchema.parse({ ...base, descriptionJson: envelope }).descriptionJson,
    ).toEqual(envelope);
  });
});
