# Rich descriptions

Assignment and problem descriptions are edited in a rich-text editor and stored as versioned
Tiptap JSON. The plain-text description is kept alongside it, always, because other clients
depend on it. This page is the contract: what is stored, what is guaranteed, and what to do when
the format needs to change.

## Storage format

Three columns move together on both `Assignment` and `Problem`:

| Column              | Purpose                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| `description`       | Plain text. Never null when a description exists. The only form other clients receive. |
| `descriptionFormat` | `PLAIN_TEXT` or `TIPTAP_JSON`. Says which column is authoritative.                     |
| `descriptionJson`   | The versioned rich document, or null.                                                  |

`descriptionJson` holds an envelope, never a bare document:

```json
{
  "version": 1,
  "document": { "type": "doc", "content": [] }
}
```

**Generated HTML is never stored.** KaTeX output and rendered markup are derived at display time
from the stored source. Nothing the browser produces is accepted as content.

## The plain-text compatibility contract

The rule that keeps the two columns honest lives in one function,
`buildDescriptionWrite` in `src/lib/rich-description/write.ts`, and every create, update,
duplicate, and import path goes through it:

- **Rich JSON present** → validate it, store it, set `TIPTAP_JSON`, and **derive** `description`
  from it. Any plain text supplied in the same request is ignored, because two independent
  sources of truth drift.
- **No rich JSON** → it is a plain-text write. Store the text, set `PLAIN_TEXT`, and clear
  `descriptionJson`.
- **Malformed rich JSON** → throw. A bad payload must never overwrite a good description. API
  routes reject it with a 400 before reaching this point via their Zod schema.

Reads go through `resolveDescription` (`src/lib/rich-description/resolve.ts`), which returns the
validated rich document only when the stored JSON is a supported envelope, and otherwise falls
back to `description`. Missing JSON, malformed JSON, an unsupported version, and an unsupported
node all take the same fallback path, so a document written by a newer version of AFCT degrades
to readable text rather than breaking a page.

### Why Java clients receive plain text only

The native student client (`jb4411/afct-client`) talks to `/api/client/v1/*`. Those serializers
select `description` explicitly and are deliberately left alone: the client has no rich-text
renderer, and a breaking change to those routes has to be coordinated with the RIT team. The same
applies to the student-facing serializers in `src/lib/student-assignments.ts` and
`src/lib/client-course-tree.ts`. **Do not add `descriptionJson` to a client API response** without
that coordination.

Plain-text extraction (`richDescriptionToPlainText`) preserves paragraph breaks, list items, code
content, and LaTeX source; inline math becomes `$latex$` and block math `$$latex$$` on its own
line. Formatting marks drop away but the text they wrapped is kept, so nothing is silently lost.

## Supported nodes and marks

The allowlists in `src/lib/rich-description/schema.ts` are the single source of truth, and the
editor's extension set must agree with them. Anything enabled in the editor but missing from the
schema produces documents that fail validation and silently fall back to plain text.

**Nodes**: `doc`, `paragraph`, `text`, `heading` (H2-H4 only; the page owns H1), `bulletList`,
`orderedList`, `listItem`, `blockquote`, `codeBlock`, `horizontalRule`, `hardBreak`, `inlineMath`,
`blockMath`.

**Marks**: `bold`, `italic`, `underline`, `code`, `link`.

**Attributes**: `heading.level`, `textAlign` (`left`, `center`, `right` on paragraphs and
headings), and `latex` on the two math nodes.

Deliberately **not** supported: full justification, font selection, arbitrary font sizes, text
colours, background colours, arbitrary HTML, embeds, video, images, tables, and file attachments.
Several of these are absent simply because no node or mark declares them, which means a paste
containing them is discarded by the schema rather than by a filter.

## Rendering and sanitization boundaries

Three layers, each independent:

1. **The editor's extension set** (`src/components/rich-description/extensions.ts`) decides what
   can be produced. Links are restricted to `https:` and `mailto:` through both `protocols` and
   `isAllowedUri`; autolink and link-on-paste are off, so a URL only becomes a link through the
   dialog.
2. **Paste cleanup** (`src/components/rich-description/paste.ts`) runs before Tiptap parses pasted
   HTML. It strips inline styles other than the few the editor genuinely reads, removes `class`,
   `id`, event handlers, and unknown `data-*` attributes, deletes elements that must never
   contribute content, and unwraps the `font-weight: normal` wrapper Google Docs puts around its
   whole clipboard payload. This is not a general HTML sanitizer, because nothing it returns is
   ever rendered as HTML.
3. **The stored-document validator** (`validateRichDescription`) is the backstop. It runs
   server-side on every write and again on every read, so a hand-crafted payload that never went
   through the UI cannot smuggle a `javascript:` href, an unsupported node, or an oversized
   equation into the database.

Content locks apply to both columns. Before an assignment unlocks, a student receives `null` for
`description` **and** `descriptionJson`; masking only one would leak the content.

## Equations

LaTeX source is the stored form, in a math node's `latex` attribute, bounded by
`MAX_LATEX_LENGTH` (2000 characters) in `src/lib/rich-description/latex.ts`. KaTeX renders it at
display time with `trust: false` (which blocks `\href`, `\url`, `\includegraphics`, and the
`\html*` family), `throwOnError: false` in the document so a bad expression degrades instead of
blanking the editor, and `maxSize` / `maxExpand` bounds. Output is `htmlAndMathml`, so screen
readers get real MathML.

When KaTeX rejects an expression, the dialog does not show its message raw. `describeLatexError`
(`src/components/rich-description/latex-error.ts`) maps the common failures to a sentence that
says what to fix, for example naming the unrecognised command or the unmatched brace, and shows
KaTeX's own wording underneath as supporting detail. The detail is kept deliberately: these are
computing-theory faculty, and many read LaTeX errors faster than prose. Add a rule there rather
than reverting to the raw message.

Equations are inserted and edited only through the equation dialog. The upstream extension's input
rules are removed on purpose: they map `$$x$$` to _inline_ math and `$$$x$$$` to a display block,
which inverts what LaTeX authors expect and disagrees with how AFCT writes math into the plain-text
description. An expression KaTeX cannot parse is not saveable, because it would render as red
error text for every student.

Block equations are always centred. The upstream `blockMath` node is an atom carrying only its
LaTeX source, so there is nowhere to store a per-equation alignment; adding one would mean forking
the official node.

KaTeX's stylesheet and fonts are served by the app itself, never from a CDN. See
[Self-hosted KaTeX assets](#self-hosted-katex-assets) for how they get there.

## Rendering on read surfaces

`RichDescription` (`src/components/rich-description/RichDescription.tsx`) renders a stored
document on read surfaces. It is a plain React walker over the validated JSON, not a second
editor: read pages get no ProseMirror, the output is server-renderable, and it reuses the same
`.afct-rich-text` styles the editor uses so authored and published content match. Pass both
fields and let it decide:

```tsx
<RichDescription description={item.description} descriptionJson={item.descriptionJson} />
```

### Which surfaces render rich content

| Surface                                                          | Audience |
| ---------------------------------------------------------------- | -------- |
| Student assignment page description                              | student  |
| `ProblemHeader` (student problem view, faculty submissions view) | both     |
| Problem description dialog on the assignment page                | faculty  |
| Problem description dialog in the course problem bank            | faculty  |
| Assignment description dialog in the course assignment table     | faculty  |

Adding a surface takes two steps, and missing the first is the failure mode to watch for: the
API response has to carry `descriptionJson` as well as `description`. The assignment table
shipped rendering plain text only because `serializeAssignment` projected `description`
explicitly and never included the rich field, so there was nothing for the component to render.
Whenever a projection lists `description` by name, it must list `descriptionJson` beside it and
apply the same content-lock mask.

**`StudentAssignmentCard` on the dashboard stays plain text on purpose.** It is a truncated
preview with a `title` tooltip, so rich markup would be clipped mid-element and the tooltip
cannot carry formatting anyway. That is a deliberate choice, not an omission.

`ProblemListCard` is not in the table because its `description` prop is the card's own static
subtitle, not a stored description.

### Fallback

Validation is whole-document, so there is one fallback: if `descriptionJson` is missing,
malformed, an unsupported version, or fails the allowlist in any way, the surface renders the
plain-text `description` instead. That is not a lossy outcome for the words. `description` is
derived from the rich document every time it is saved, so the reader still gets the full text and
loses only the formatting.

There is no partial rendering. One unsupported node takes the whole description down to plain
text rather than rendering its valid siblings, because `validateRichDescription` accepts or
rejects the envelope as a unit.

`RichDescription` also carries per-node guards for an unsupported node type, unusable latex, and
a rejected href. Those are **defense in depth, not behaviour you can observe**: the validator
already rejects each of those cases using the same predicates the walker would, so a document
that reaches the walker cannot contain them. They exist because the walker is the last thing
between stored data and the DOM. Treat them as unreachable when reasoning about what a reader
sees, and be wary of a test that appears to exercise them.

Fallbacks log a `console.warn` outside production. There is no structured client logger to route
them to, and a malformed description is a content problem for its author rather than an
operational event.

`RichDescription` also wraps its output in `RichDescriptionBoundary`, a React error boundary
that swaps in the same plain-text fallback if rendering throws. Validation is total, so this
should never fire; it is there because these surfaces carry assignment prompts, and a thrown
render takes out the whole client tree rather than one description. A student seeing a blank
assignment page near a deadline is a far worse failure than losing some formatting. It lives
inside the shared component rather than at each call site, so a newly added surface inherits it.

### Caching

Two caches, both keyed on values that fully determine the result:

- `renderDescriptionMath` memoizes KaTeX output by `(latex, displayMode)`. Rendering is pure, and
  the walker re-runs it for every equation on every render. The map is bounded and cleared
  wholesale when full, because the module is also loaded server-side where an unbounded map
  would leak slowly.
- `RichDescription` memoizes validation results in a `WeakMap` keyed on the `descriptionJson`
  object. A `useMemo` would have been the obvious tool but would make the component a hook
  consumer, and it is deliberately usable from a Server Component. Sound because the input is
  parsed JSON that nobody mutates; a refetch yields a new object and revalidates.

### Links

Rendered links go back through the same policy the editor enforces. `https:` leaves AFCT, so it
opens in a new tab with `rel="noopener noreferrer nofollow"`; `mailto:` stays in the same tab,
because `target="_blank"` on a mail handoff leaves a stranded blank tab. There is no
internal-link case: the protocol allowlist accepts only those two schemes, so a relative path
cannot be stored in the first place. An href that fails the check renders as plain text.

### Maths and accessibility

`renderDescriptionMath(latex, displayMode)` in `render-math.ts` is the single place KaTeX is
called for rendering. Output is `htmlAndMathml`, so screen readers get real MathML rather than
styled spans. It is also the only `dangerouslySetInnerHTML` in the feature, and deliberately
narrow: the input is a schema-validated latex string bounded by `MAX_LATEX_LENGTH`, and
`trust: false` refuses the commands that emit markup or fetch resources. KaTeX does echo the
original TeX into a MathML `<annotation>` element, which is inert text content.

### Headings

Descriptions render `h2` to `h4`, clamped by the renderer to `ALLOWED_HEADING_LEVELS` whatever an
older document claims, so a description can never introduce a competing `h1`. Surfaces that embed
one already sit under their own heading (the assignment page uses an `h2` "Description" label,
and `DialogTitle` is itself an `h2`), which makes description headings siblings rather than
children. That is a valid outline and avoided adding a level-shifting prop that every call site
would have to get right.

### Density

`compact` tightens vertical rhythm through the `.afct-rich-text--compact` modifier, for cards,
list rows, and problem headers. Prefer it over one-off spacing classes at call sites, which drift
apart. No editor chrome is reused on read surfaces.

### Locked content

Locked content is removed before serialization, never merely hidden by a component. Before an
assignment unlocks, `getStudentCourseAssignments` nulls **both** `description` and
`descriptionJson` and returns no problems at all, so neither form reaches the browser.
`student-assignments.lock.test.ts` proves it by putting distinctive secret strings in a locked
description and asserting they appear nowhere in the serialized response.

### Self-hosted KaTeX assets

KaTeX's stylesheet and fonts live in `public/katex/` and are linked from the root layout
(`src/app/layout.tsx`), not imported through the bundler. `scripts/vendor-katex.mjs` copies
`katex.min.css` and the `fonts/` directory out of `node_modules/katex/dist` verbatim. This is
KaTeX's documented browser setup: the stylesheet references its fonts with relative URLs, so
keeping the two next to each other makes those URLs resolve with nothing rewritten.

Re-run it after changing the `katex` dependency, and commit the result:

```bash
npm run vendor:katex
```

The copy is deliberately dumb. Nothing is parsed or rewritten, so the vendored files stay
byte-identical to upstream and a KaTeX upgrade cannot half-apply. All three font formats are
kept for the same reason, even though browsers only ever fetch the 20 `.woff2` files; the extra
files cost repository size, not page weight.

The reason it is a `<link>` rather than an import: the stylesheet references 60 font files, and
a bundler import turns each one into a module in the chunk graph of every route that renders a
description. That made dev compiles stall for minutes. Because Next steers you toward importing
CSS, the tag trips `@next/next/no-css-tags`, which is suppressed on that one line with the
reasoning recorded next to it. The assets are same-origin and are never fetched from a CDN.

### Bundle tradeoff and a possible optimisation

KaTeX's JavaScript (about 270 KB) still reaches any page that renders a description, because the
read surfaces are client components. Only the CSS and fonts were moved out of the bundle above.
`renderDescriptionMath` is isolated in its own module and uses no browser API precisely so maths
rendering can later move behind a server-only boundary, keeping that JavaScript away from
students, without rewriting the document walker. That refactor is not done: it needs the read
surfaces to stop being client components, or a server-rendered HTML string threaded down to them.

## Introducing a new JSON version

`version` exists so a future format change is a migration rather than a break. To add version 2:

1. Bump `RICH_DESCRIPTION_VERSION` and accept **both** versions in
   `richDescriptionEnvelopeSchema`. A reader that only accepts the newest version turns every
   existing description into a plain-text fallback.
2. Write an upgrade function from 1 to 2 and call it in `resolveDescription`, so old rows are
   read forward without a data migration.
3. Only write the new version. Rows keep their stored version until something saves them.
4. Extend `richDescriptionToPlainText` to cover any new node, or its text disappears from the
   plain-text column and therefore from the Java client.
5. Backfilling existing rows is optional and separate. The read path already handles a mix.

Removing support for version 1 is a breaking change: every unsaved row would fall back to plain
text and lose its formatting.

## Where the editor is used

`RichDescriptionField` (label + editor + error wiring) is the component every form uses; mount
`RichDescriptionEditor` directly only when a form field is the wrong shape. Both live in
`src/components/rich-description/`. Current surfaces: the create-assignment wizard, the assignment
page's Assignment tab, the duplicate and import assignment dialogs, and the create, edit,
duplicate, and import problem dialogs.

A legacy plain-text record converts to rich JSON **only when its description is actually edited
and saved**. The editor emits nothing on mount, so opening a form and saving it does not rewrite
the format. Duplicate and import carry the source's stored document through untouched, so copying
a rich description keeps it rich.

The problem create and update routes take multipart form data (they carry the solution file), so
the envelope arrives as a JSON string and is parsed by a preprocessing field in
`src/schemas/problem.ts` before the envelope schema runs.
