import { describe, it, expect } from 'vitest';
import { resolveDescription } from './resolve';

const richJson = {
  version: 1,
  document: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'rich body' }] }],
  },
};

describe('resolveDescription', () => {
  it('returns plain text for a PLAIN_TEXT record', () => {
    const r = resolveDescription({
      description: 'hi',
      descriptionFormat: 'PLAIN_TEXT',
      descriptionJson: null,
    });
    expect(r).toEqual({ format: 'PLAIN_TEXT', plainText: 'hi' });
  });

  it('treats a null description as empty', () => {
    const r = resolveDescription({
      description: null,
      descriptionFormat: 'PLAIN_TEXT',
      descriptionJson: null,
    });
    expect(r).toEqual({ format: 'PLAIN_TEXT', plainText: '' });
  });

  it('returns the validated document and derived plain text for a valid TIPTAP_JSON record', () => {
    const r = resolveDescription({
      description: 'rich body',
      descriptionFormat: 'TIPTAP_JSON',
      descriptionJson: richJson,
    });
    expect(r.format).toBe('TIPTAP_JSON');
    if (r.format === 'TIPTAP_JSON') {
      expect(r.plainText).toBe('rich body');
      expect(r.envelope.version).toBe(1);
    }
  });

  it('falls back to plain text when the JSON is malformed / unsupported', () => {
    const bad = { version: 1, document: { type: 'doc', content: [{ type: 'image' }] } };
    const r = resolveDescription({
      description: 'fallback',
      descriptionFormat: 'TIPTAP_JSON',
      descriptionJson: bad,
    });
    expect(r).toEqual({ format: 'PLAIN_TEXT', plainText: 'fallback' });
  });

  it('falls back when the version is unsupported', () => {
    const r = resolveDescription({
      description: 'fallback',
      descriptionFormat: 'TIPTAP_JSON',
      descriptionJson: { version: 99, document: { type: 'doc' } },
    });
    expect(r).toEqual({ format: 'PLAIN_TEXT', plainText: 'fallback' });
  });

  it('falls back when format says TIPTAP_JSON but json is missing', () => {
    const r = resolveDescription({
      description: 'fallback',
      descriptionFormat: 'TIPTAP_JSON',
      descriptionJson: null,
    });
    expect(r).toEqual({ format: 'PLAIN_TEXT', plainText: 'fallback' });
  });

  it('ignores stray json when the format is PLAIN_TEXT', () => {
    const r = resolveDescription({
      description: 'plain',
      descriptionFormat: 'PLAIN_TEXT',
      descriptionJson: richJson,
    });
    expect(r).toEqual({ format: 'PLAIN_TEXT', plainText: 'plain' });
  });
});
