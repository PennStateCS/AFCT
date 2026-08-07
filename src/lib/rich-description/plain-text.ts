import {
  RICH_DESCRIPTION_VERSION,
  INLINE_MATH_NODE,
  BLOCK_MATH_NODE,
  MATH_LATEX_ATTR,
  type RichDescriptionEnvelope,
  type TiptapDocument,
  type TiptapNode,
} from './schema';

/**
 * Turn a plain-text description into a basic Tiptap document. Each newline-separated line
 * becomes a paragraph (blank lines become empty paragraphs), so the break structure survives
 * a round-trip through richDescriptionToPlainText.
 */
export function plainTextToRichDescription(text: string): RichDescriptionEnvelope {
  const content: TiptapNode[] = (text ?? '')
    .split('\n')
    .map((line) =>
      line.length === 0
        ? { type: 'paragraph' }
        : { type: 'paragraph', content: [{ type: 'text', text: line }] },
    );
  return { version: RICH_DESCRIPTION_VERSION, document: { type: 'doc', content } };
}

function inlineText(node: TiptapNode): string {
  switch (node.type) {
    case 'text':
      return node.text ?? '';
    case 'hardBreak':
      return '\n';
    case INLINE_MATH_NODE:
      // Keep the LaTeX source, delimited so it reads as math in plain text.
      return `$${String(node.attrs?.[MATH_LATEX_ATTR] ?? '')}$`;
    default:
      return (node.content ?? []).map(inlineText).join('');
  }
}

function blockText(node: TiptapNode): string {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return (node.content ?? []).map(inlineText).join('');
    case 'codeBlock':
      // Code-block content is text nodes (with embedded newlines); keep it as-is.
      return (node.content ?? []).map(inlineText).join('');
    case 'blockquote':
      return blocksText(node.content ?? []);
    case 'horizontalRule':
      return '---';
    case BLOCK_MATH_NODE:
      // Block math on its own line, LaTeX source preserved.
      return `$$${String(node.attrs?.[MATH_LATEX_ATTR] ?? '')}$$`;
    case 'bulletList':
      return (node.content ?? []).map((item) => `- ${blockText(item)}`).join('\n');
    case 'orderedList':
      return (node.content ?? []).map((item, i) => `${i + 1}. ${blockText(item)}`).join('\n');
    case 'listItem':
      return blocksText(node.content ?? []);
    default:
      return (node.content ?? []).map(inlineText).join('');
  }
}

function blocksText(nodes: TiptapNode[]): string {
  return nodes.map((n) => blockText(n)).join('\n');
}

/**
 * Extract readable plain text from a validated rich-description envelope (or bare doc).
 * Preserves paragraph breaks, list items, code content, and LaTeX source. Formatting marks
 * (bold/italic/etc.) drop away but the text they wrap is kept - nothing is silently omitted.
 */
export function richDescriptionToPlainText(
  input: RichDescriptionEnvelope | TiptapDocument,
): string {
  const doc = 'document' in input ? input.document : input;
  return blocksText(doc.content ?? []);
}
