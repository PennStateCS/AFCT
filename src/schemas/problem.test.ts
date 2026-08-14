import { describe, it, expect } from 'vitest';
import { CreateProblemSchema } from './problem';
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

/**
 * The answer-key file deliberately has no size limit in the schema.
 *
 * It used to cap at a hardcoded 5MB while the upload input in the same dialog and the
 * route behind it both used the admin's configured limit. Raising the setting therefore
 * did nothing: the browser still refused a file the server would have accepted. This
 * fails if someone puts a constant back.
 */
describe('CreateProblemSchema answer-key size', () => {
  it('leaves the size limit to the configured setting rather than a constant', () => {
    const big = new File(['x'.repeat(8 * 1024 * 1024)], 'answer.jff', { type: 'text/xml' });

    const result = CreateProblemSchema.safeParse({
      title: 'Even length',
      type: 'FA',
      file: big,
    });

    // Whatever else it says about the payload, it must not be complaining about size.
    const issues = result.success ? [] : result.error.issues.map((i) => i.message);
    expect(issues.join(' ')).not.toMatch(/MB|size/i);
  });

  it('still refuses a file with the wrong extension', () => {
    const wrong = new File(['x'], 'answer.pdf', { type: 'application/pdf' });

    const result = CreateProblemSchema.safeParse({ title: 'T', type: 'FA', file: wrong });

    expect(result.success).toBe(false);
  });
});
