import { describe, it, expect } from 'vitest';
import { validateRichDescription, type RichDescriptionEnvelope } from './schema';

function envelope(...content: unknown[]): unknown {
  return { version: 1, document: { type: 'doc', content } };
}

describe('validateRichDescription', () => {
  it('accepts an empty document', () => {
    expect(validateRichDescription({ version: 1, document: { type: 'doc' } }).ok).toBe(true);
    expect(validateRichDescription(envelope()).ok).toBe(true);
  });

  it('accepts a document using every supported node and mark', () => {
    const value = envelope(
      {
        type: 'heading',
        attrs: { level: 2, textAlign: 'center' },
        content: [{ type: 'text', text: 'Title' }],
      },
      {
        type: 'paragraph',
        attrs: { textAlign: 'right' },
        content: [
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          { type: 'text', text: 'under', marks: [{ type: 'underline' }] },
          { type: 'text', text: 'code', marks: [{ type: 'code' }] },
          {
            type: 'text',
            text: 'link',
            marks: [{ type: 'link', attrs: { href: 'https://a.test' } }],
          },
          { type: 'inlineMath', attrs: { latex: 'x^2' } },
          { type: 'hardBreak' },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
          },
        ],
      },
      {
        type: 'orderedList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
          },
        ],
      },
      {
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quote' }] }],
      },
      { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1;' }] },
      { type: 'horizontalRule' },
      { type: 'blockMath', attrs: { latex: '\\int x' } },
    );
    const result = validateRichDescription(value);
    expect(result.ok).toBe(true);
  });

  it('rejects a wrong or missing version', () => {
    expect(validateRichDescription({ version: 2, document: { type: 'doc' } }).ok).toBe(false);
    expect(validateRichDescription({ version: '1', document: { type: 'doc' } }).ok).toBe(false);
    expect(validateRichDescription({ document: { type: 'doc' } }).ok).toBe(false);
  });

  it('rejects a missing or wrong document', () => {
    expect(validateRichDescription({ version: 1 }).ok).toBe(false);
    expect(validateRichDescription({ version: 1, document: { type: 'notdoc' } }).ok).toBe(false);
  });

  it('rejects unknown node types', () => {
    expect(validateRichDescription(envelope({ type: 'image', attrs: { src: 'x' } })).ok).toBe(
      false,
    );
    expect(validateRichDescription(envelope({ type: 'table' })).ok).toBe(false);
  });

  it('rejects unknown mark types', () => {
    const value = envelope({
      type: 'paragraph',
      content: [{ type: 'text', text: 'x', marks: [{ type: 'strike' }] }],
    });
    expect(validateRichDescription(value).ok).toBe(false);
  });

  it('rejects justify alignment', () => {
    const value = envelope({
      type: 'paragraph',
      attrs: { textAlign: 'justify' },
      content: [{ type: 'text', text: 'x' }],
    });
    expect(validateRichDescription(value).ok).toBe(false);
  });

  it('rejects an out-of-range heading level', () => {
    const value = envelope({
      type: 'heading',
      attrs: { level: 7 },
      content: [{ type: 'text', text: 'x' }],
    });
    expect(validateRichDescription(value).ok).toBe(false);
  });

  it('rejects a math node without latex', () => {
    expect(validateRichDescription(envelope({ type: 'inlineMath', attrs: {} })).ok).toBe(false);
    expect(validateRichDescription(envelope({ type: 'blockMath' })).ok).toBe(false);
  });

  it('rejects a link mark without an href', () => {
    const value = envelope({
      type: 'paragraph',
      content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: {} }] }],
    });
    expect(validateRichDescription(value).ok).toBe(false);
  });

  it('rejects non-object / junk input', () => {
    for (const junk of [null, undefined, 42, 'string', [], true]) {
      expect(validateRichDescription(junk).ok).toBe(false);
    }
  });

  // The depth bound has to be enforced before Zod parses, because nodeSchema is recursive and a
  // deep payload exhausts the stack inside safeParse. A RangeError is not a ZodError, so it would
  // escape as a throw: a 500 on write, and a blank page on a read surface. These assert the
  // function stays total.
  describe('pathological input is rejected rather than thrown', () => {
    const nest = (depth: number) => {
      let node: unknown = { type: 'text', text: 'x' };
      for (let i = 0; i < depth; i += 1) node = { type: 'paragraph', content: [node] };
      return node;
    };

    it('rejects nesting deep enough to overflow the parser stack', () => {
      const result = validateRichDescription(envelope(nest(5000)));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/nests deeper/);
    });

    it('still accepts nesting within the limit', () => {
      expect(validateRichDescription(envelope(nest(5))).ok).toBe(true);
    });

    it('terminates on a cyclic value instead of spinning', () => {
      const cyclic: { type: string; content: unknown[] } = { type: 'paragraph', content: [] };
      cyclic.content.push(cyclic);
      expect(validateRichDescription(envelope(cyclic)).ok).toBe(false);
    });

    it('rejects more nodes than the budget allows', () => {
      const many = Array.from({ length: 6000 }, () => ({ type: 'paragraph' }));
      const result = validateRichDescription(envelope(...many));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/more than/);
    });
  });

  it('narrows the type on success', () => {
    const result = validateRichDescription({ version: 1, document: { type: 'doc' } });
    if (result.ok) {
      const env: RichDescriptionEnvelope = result.envelope;
      expect(env.version).toBe(1);
      expect(env.document.type).toBe('doc');
    } else {
      throw new Error('expected ok');
    }
  });
});
