import { describe, it, expect } from 'vitest';
import { buildDescriptionWrite, InvalidRichDescriptionError } from './write';

const richJson = {
  version: 1,
  document: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'line one' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'line two' }] },
    ],
  },
};

describe('buildDescriptionWrite', () => {
  it('treats a plain-text write as PLAIN_TEXT and clears the rich JSON', () => {
    expect(buildDescriptionWrite({ description: 'hello' })).toEqual({
      description: 'hello',
      descriptionFormat: 'PLAIN_TEXT',
      descriptionJson: null,
    });
  });

  it('normalizes a missing description to null', () => {
    expect(buildDescriptionWrite({})).toEqual({
      description: null,
      descriptionFormat: 'PLAIN_TEXT',
      descriptionJson: null,
    });
    expect(buildDescriptionWrite({ description: null })).toEqual({
      description: null,
      descriptionFormat: 'PLAIN_TEXT',
      descriptionJson: null,
    });
  });

  it('stores rich JSON and DERIVES the plain text from it', () => {
    const out = buildDescriptionWrite({ descriptionJson: richJson });
    expect(out.descriptionFormat).toBe('TIPTAP_JSON');
    expect(out.descriptionJson).toEqual(richJson);
    expect(out.description).toBe('line one\nline two');
  });

  it('ignores separately supplied plain text when rich JSON is present', () => {
    // The JSON is authoritative: a caller cannot make the plain text disagree with it.
    const out = buildDescriptionWrite({ description: 'LIES', descriptionJson: richJson });
    expect(out.description).toBe('line one\nline two');
    expect(out.descriptionFormat).toBe('TIPTAP_JSON');
  });

  it('throws on malformed rich JSON instead of writing anything', () => {
    const bad = { version: 1, document: { type: 'doc', content: [{ type: 'image' }] } };
    expect(() => buildDescriptionWrite({ description: 'keep me', descriptionJson: bad })).toThrow(
      InvalidRichDescriptionError,
    );
  });

  it('throws on an unsupported version', () => {
    expect(() =>
      buildDescriptionWrite({ descriptionJson: { version: 99, document: { type: 'doc' } } }),
    ).toThrow(InvalidRichDescriptionError);
  });
});
