/** @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { createRichDescriptionExtensions } from './extensions';
import {
  ALLOWED_CONTENT_NODE_TYPES,
  ALLOWED_HEADING_LEVELS,
  ALLOWED_MARK_TYPES,
  ALLOWED_TEXT_ALIGN,
  validateRichDescription,
} from '@/lib/rich-description';

/**
 * The editor's extension set and the stored-document validator have to describe the same feature
 * surface. An extension enabled here but missing from the allowlist produces documents that fail
 * validation and silently fall back to plain text, which is the kind of drift nobody notices until
 * a faculty member loses formatting. These assertions derive the real ProseMirror schema from the
 * extensions, so they catch it mechanically instead of relying on someone re-reading both lists.
 */
const schema = getSchema(createRichDescriptionExtensions());
const nodeNames = Object.keys(schema.nodes);
const markNames = Object.keys(schema.marks);

describe('rich-description feature surface', () => {
  it('produces no node the validator would reject', () => {
    // `doc` is the top-level type, validated separately from its content.
    const unexpected = nodeNames.filter(
      (name) => name !== 'doc' && !(ALLOWED_CONTENT_NODE_TYPES as readonly string[]).includes(name),
    );
    expect(unexpected).toEqual([]);
  });

  it('produces no mark the validator would reject', () => {
    const unexpected = markNames.filter(
      (name) => !(ALLOWED_MARK_TYPES as readonly string[]).includes(name),
    );
    expect(unexpected).toEqual([]);
  });

  it('supports every intended feature', () => {
    for (const node of [
      'paragraph',
      'heading',
      'bulletList',
      'orderedList',
      'listItem',
      'blockquote',
      'codeBlock',
      'horizontalRule',
      'hardBreak',
      'inlineMath',
      'blockMath',
    ]) {
      expect(nodeNames, `missing node ${node}`).toContain(node);
    }
    for (const mark of ['bold', 'italic', 'underline', 'code', 'link']) {
      expect(markNames, `missing mark ${mark}`).toContain(mark);
    }
  });

  it('supports none of the deliberately excluded features', () => {
    // Images, tables, embeds, attachments, colour, font control, strikethrough. Most are absent
    // because no extension declares them, which is exactly why a paste containing them is
    // dropped by the schema rather than by a filter.
    for (const node of [
      'image',
      'table',
      'tableRow',
      'tableCell',
      'tableHeader',
      'youtube',
      'video',
      'iframe',
      'file',
      'attachment',
      'emoji',
      'mention',
      'taskList',
      'taskItem',
    ]) {
      expect(nodeNames, `unexpected node ${node}`).not.toContain(node);
    }
    for (const mark of [
      'strike',
      'textStyle',
      'color',
      'highlight',
      'fontFamily',
      'fontSize',
      'backgroundColor',
      'subscript',
      'superscript',
    ]) {
      expect(markNames, `unexpected mark ${mark}`).not.toContain(mark);
    }
  });

  it('parses only H2-H4, so the page keeps sole ownership of H1', () => {
    // Tiptap builds the heading parse rules from the configured levels, so an <h1> or <h5> in a
    // paste is not read as a heading at all. Asserting on the rules is what proves it: the attr
    // default is 1 regardless of configuration, which is why the validator bounds the level too.
    const tags = (schema.nodes.heading.spec.parseDOM ?? []).map((rule) => rule.tag);
    expect(tags.sort()).toEqual(['h2', 'h3', 'h4']);
    expect(tags).not.toContain('h1');
  });

  it('bounds stored heading levels to the ones the editor can produce', () => {
    expect([...ALLOWED_HEADING_LEVELS]).toEqual([2, 3, 4]);
    // A hand-crafted level-1 heading must not validate: it would compete with the page's H1.
    const withLevel = (level: number) => ({
      version: 1,
      document: { type: 'doc', content: [{ type: 'heading', attrs: { level } }] },
    });
    expect(validateRichDescription(withLevel(2)).ok).toBe(true);
    expect(validateRichDescription(withLevel(1)).ok).toBe(false);
    expect(validateRichDescription(withLevel(5)).ok).toBe(false);
  });

  it('offers exactly left, center, and right alignment (never justify)', () => {
    expect([...ALLOWED_TEXT_ALIGN]).toEqual(['left', 'center', 'right']);
    expect(ALLOWED_TEXT_ALIGN as readonly string[]).not.toContain('justify');
  });
});
