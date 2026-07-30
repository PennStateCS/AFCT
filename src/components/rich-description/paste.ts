/**
 * Paste cleanup for rich descriptions.
 *
 * The schema is the real guarantee: ProseMirror drops any node or mark the editor does not
 * declare, so a pasted table, image, or coloured span cannot become part of the document. This
 * pass runs BEFORE that parse and exists for the things the schema would otherwise keep or
 * mis-read:
 *
 *  - `style` attributes. Our own TextAlign parses `style="text-align: …"`, and Bold/Italic parse
 *    `font-weight` / `font-style`, so a Word or Google Docs paste carries real influence through
 *    inline CSS. Everything except the handful of properties we deliberately honour is stripped,
 *    which is what keeps pasted fonts, sizes, and colours out.
 *  - Google Docs wraps its entire clipboard payload in `<b style="font-weight:normal">`, which
 *    the Bold rule would otherwise read as "make all of this bold".
 *  - Word's `<o:p>` / `mso-` cruft and HTML comments, which bloat the parse for nothing.
 *  - Elements that should never contribute content at all (script, style, img, iframe, …). The
 *    schema already discards them, but removing them here means their text content does not leak
 *    into the document as stray paragraphs.
 *
 * Deliberately NOT a general-purpose HTML sanitizer: nothing this returns is ever rendered as
 * HTML. It is parsed into Tiptap JSON against a closed schema, and the stored document is
 * re-validated server-side. This only shapes what that parse sees.
 */

/** Inline CSS properties the editor genuinely reads. Everything else is discarded. */
const KEPT_STYLE_PROPERTIES = new Set([
  'text-align',
  'font-weight',
  'font-style',
  'text-decoration',
]);

/** Elements removed outright, with their contents. */
const DROPPED_ELEMENTS = [
  'script',
  'style',
  'noscript',
  'meta',
  'link',
  'title',
  'base',
  'img',
  'picture',
  'source',
  'video',
  'audio',
  'iframe',
  'object',
  'embed',
  'svg',
  'canvas',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'template',
];

/** Attributes stripped from every surviving element (href/src handling is the schema's job). */
const DROPPED_ATTRIBUTES = [
  'class',
  'id',
  'dir',
  'lang',
  'width',
  'height',
  'align',
  'bgcolor',
  'color',
  'face',
  'size',
];

/**
 * The only `data-*` attributes kept. These are the ones AFCT's own extensions parse, so copying a
 * description out of one editor (or out of a rendered page) and into another keeps its equations
 * and alignment instead of silently flattening them.
 */
const KEPT_DATA_ATTRIBUTES = new Set(['data-type', 'data-latex', 'data-align']);

/** Keep only the properties we parse, so pasted fonts/colours/sizes cannot survive. */
function filterStyle(element: Element): void {
  const style = element.getAttribute('style');
  if (style === null) return;
  const kept = style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      const property = declaration.split(':')[0]?.trim().toLowerCase();
      return property !== undefined && KEPT_STYLE_PROPERTIES.has(property);
    });
  if (kept.length === 0) element.removeAttribute('style');
  else element.setAttribute('style', kept.join('; '));
}

/** Replace an element with its own children, keeping the text and structure inside it. */
function unwrap(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

/**
 * Clean a pasted HTML fragment. Returns HTML for Tiptap to parse; supported semantic structure
 * (paragraphs, headings, lists, emphasis, links, code) is preserved, presentation is not.
 */
export function sanitizePastedHTML(html: string): string {
  if (!html) return html;
  // No DOM (SSR, or a non-browser caller): leave it alone rather than half-processing it. Paste
  // only ever happens in the browser, and the schema still gates whatever arrives.
  if (typeof DOMParser === 'undefined') return html;

  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Word emits its instructions inside comments; remove them before anything else reads them.
  const comments = doc.createTreeWalker(doc.body, 0x80 /* SHOW_COMMENT */);
  const staleComments: ChildNode[] = [];
  while (comments.nextNode()) staleComments.push(comments.currentNode as ChildNode);
  staleComments.forEach((comment) => comment.remove());

  doc.body.querySelectorAll(DROPPED_ELEMENTS.join(',')).forEach((element) => element.remove());

  // Word namespaced tags (<o:p>, <w:sdt>): drop the element, keep any text it wrapped.
  Array.from(doc.body.querySelectorAll('*'))
    .filter((element) => element.tagName.includes(':'))
    .forEach(unwrap);

  // Google Docs' wrapper: a <b> that explicitly sets font-weight:normal is presentational noise,
  // and leaving it makes the whole paste bold.
  Array.from(doc.body.querySelectorAll('b,strong'))
    .filter((element) =>
      /font-weight\s*:\s*(normal|400)/i.test(element.getAttribute('style') ?? ''),
    )
    .forEach(unwrap);

  doc.body.querySelectorAll('*').forEach((element) => {
    DROPPED_ATTRIBUTES.forEach((attribute) => element.removeAttribute(attribute));
    // Event handlers, and any data-* hook other than the three the editor parses.
    Array.from(element.attributes)
      .filter(
        (attribute) =>
          /^on/i.test(attribute.name) ||
          (/^data-/i.test(attribute.name) &&
            !KEPT_DATA_ATTRIBUTES.has(attribute.name.toLowerCase())),
      )
      .forEach((attribute) => element.removeAttribute(attribute.name));
    filterStyle(element);
  });

  return doc.body.innerHTML;
}
