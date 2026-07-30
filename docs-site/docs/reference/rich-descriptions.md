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

Reads go through `resolveDescription` (`src/lib/rich-description/resolve.ts`) on the server, and
through `parseRichDescriptionForRender` in the renderer. Missing JSON, malformed JSON, and an
unsupported version fall back to `description`. An unsupported NODE does not: see
[Fallback](#fallback) for how the renderer degrades a single node instead of the whole document.

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
   dialog. The editor, the validator, the renderer, and the link dialog all call
   `validateLinkUrl`, so there is one interpretation of the policy rather than four.
2. **Paste cleanup** (`src/components/rich-description/paste.ts`) runs before Tiptap parses pasted
   HTML. It strips inline styles other than the few the editor genuinely reads, removes `class`,
   `id`, event handlers, and unknown `data-*` attributes, deletes elements that must never
   contribute content, and unwraps the `font-weight: normal` wrapper Google Docs puts around its
   whole clipboard payload. This is not a general HTML sanitizer, because nothing it returns is
   ever rendered as HTML.
3. **The stored-document validator** is the backstop, in two strengths.
   `validateRichDescription` runs server-side on every WRITE and is strict: a hand-crafted payload
   that never went through the UI cannot store a `javascript:` href, an unsupported node, or an
   oversized equation. `parseRichDescriptionForRender` runs on READ and checks structure and the
   size limits only, because a stored document may legitimately come from a newer AFCT; the walker
   re-applies the same href, latex, heading, and alignment policies node by node.

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
`.afct-rich-text` styles the editor uses so authored and published content match. The one client
component in it is `DescriptionMath`, which is what fetches KaTeX on demand; see
[KaTeX in the client bundle](#katex-in-the-client-bundle). Pass both fields and let it decide:

```tsx
<RichDescription description={item.description} descriptionJson={item.descriptionJson} />
```

### Moving the three columns together

`description`, `descriptionFormat`, and `descriptionJson` are one value split across three
columns, and reading or sending a subset is always a bug. It has shipped twice: an assignment
serializer named `description` and omitted `descriptionJson`, so the staff table could only ever
render plain text, and the course-update handler had the same gap. Both were invisible because
nothing tied the fields together.

Use the helpers in `src/lib/rich-description/projection.ts` instead of naming the columns:

- `assignmentDescriptionSelect` / `problemDescriptionSelect` for Prisma selects.
- `projectDescription(record, { locked })` for responses. It returns all three fields and applies
  the content lock to all of them from one decision, so a locked prompt cannot leak through the
  rich copy. When locked it reports `PLAIN_TEXT`, so a client cannot even infer that a rich
  document exists.
- `projectPlainDescriptionOnly(record, { locked })` for the Java-client paths that must not
  receive the rich document.

`projection.test.ts` asserts the key set structurally rather than by matching source text, so a
field dropped from the projection fails there.

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

Failure is graded. Losing an entire assignment prompt because of one unrecognised node is a much
worse outcome than losing the node, so the renderer degrades in layers.

The whole document falls back to the plain-text `description` only when there is nothing safe to
show at all:

- the envelope is missing or malformed,
- `version` is not one this build supports,
- the root is not a `doc`,
- or the document exceeds the depth, node-count, or text-size limits.

That is not lossy for the words. `description` is derived from the rich document every time it is
saved, so the reader still gets the full text and loses only the formatting.

Everything else degrades locally:

| Situation                                        | What happens                                   |
| ------------------------------------------------ | ---------------------------------------------- |
| Node type this build does not know               | The wrapper is dropped and its children render |
| Unknown node with no children but with text      | Its text renders                               |
| Mark this build does not know                    | The styling is dropped and the text renders    |
| Link href outside the protocol allowlist         | The link is dropped and the text renders       |
| Alignment or heading level outside the allowlist | The attribute is ignored, the block renders    |
| Equation whose source fails the latex policy     | Its LaTeX source renders as inline code        |

A document written by a NEWER AFCT therefore keeps rendering here, minus the parts this build
cannot draw.

Two parsers back this. `validateRichDescription` stays strict and is what WRITES go through, so
an unknown node or an unsafe href still cannot be stored via AFCT.
`parseRichDescriptionForRender` checks structure and the size limits only, and hands everything
else to the walker. The safety rules did not weaken, they moved: the walker re-checks every href
through `isAllowedLinkHref`, every equation through `isAllowedLatex`, and every heading level and
alignment against the shared allowlists, and it never emits an element or attribute for anything
it does not recognise. What changed is the blast radius of one bad node.

`RichDescription` also wraps its output in `RichDescriptionBoundary`, a React error boundary that
swaps in the plain-text fallback if rendering throws. It lives inside the shared component rather
than at each call site, so a newly added surface inherits it.

Fallbacks log a `console.warn` outside production. There is no structured client logger to route
them to, and a malformed description is a content problem for its author rather than an
operational event.

### Heading levels

Authored headings are H2 to H4, written as if the description owned the page. Real surfaces sit
at different depths, so `RichDescription` takes a `headingBaseLevel` prop that shifts the whole
range while preserving the hierarchy the author wrote:

```tsx
<RichDescription headingBaseLevel={3} description={...} descriptionJson={...} />
```

With a base of 3, an authored H2/H3/H4 renders as H3/H4/H5. Levels are clamped to H2..H6, so a
description can never emit an H1 (the page owns that) or an invalid tag. The default is 2, which
is the behaviour every call site had before the prop existed.

Pick the base from the heading that actually precedes the description on that surface:

| Surface                                                               | Preceding heading                                     | Base |
| --------------------------------------------------------------------- | ----------------------------------------------------- | ---- |
| Student assignment description                                        | the `<h2>Description</h2>` above it                   | 3    |
| `ProblemHeader`                                                       | `CardTitle`, which is `role="heading" aria-level={3}` | 4    |
| Description dialogs (assignment table, problem bank, assignment page) | `DialogTitle`, an `h2`                                | 3    |

If you change one of those surrounding headings, change the base with it.

### Caching

One cache, on the only operation expensive enough to warrant it: `renderDescriptionMath`
memoizes KaTeX output by `(latex, displayMode)`. Rendering is pure, and the walker re-runs it for
every equation on every render. The map is bounded and cleared wholesale when full, because the
module is also loaded server-side where an unbounded map would leak slowly. It is only consulted
once KaTeX itself has loaded; before that the renderer declines outright.

Parsing is deliberately NOT cached. It was memoized in a `WeakMap` keyed on the `descriptionJson`
object for a while; that was removed. The saving was not measurable against a document of a few
hundred nodes, and an identity cache quietly assumes nobody mutates the parsed JSON in place,
which is an invariant no type in this codebase enforces. Regression tests in
`subtree-fallback.test.tsx` assert that a mutated or replaced value re-parses.

### Self-hosted KaTeX assets

KaTeX's stylesheet and fonts live in `public/katex/` and are linked from the root layout
(`src/app/layout.tsx`), not imported through the bundler. `scripts/vendor-katex.mjs` copies them
out of `node_modules/katex/dist`. This is KaTeX's documented browser setup: the stylesheet
references its fonts with relative URLs, so keeping the two next to each other makes those URLs
resolve.

Re-run it after changing the `katex` dependency, and commit the result:

```bash
npm run vendor:katex
```

The reason it is a `<link>` rather than an import: the stylesheet references font files, and a
bundler import turns each one into a module in the chunk graph of every route that renders a
description. That made dev compiles stall for minutes. Because Next steers you toward importing
CSS, the tag trips `@next/next/no-css-tags`, which is suppressed on that one line with the
reasoning recorded next to it. The assets are same-origin and never come from a CDN.

**WOFF2 only.** Upstream ships each face three times (woff2, woff, ttf) and lists all three in
one `src`. A browser takes the first format it supports, so every browser AFCT supports takes the
woff2 and the other two are dead weight. The script keeps the 20 woff2 files and deletes the
matching `url(...) format(...)` entries from the stylesheet, taking `public/katex` from about
1.2 MB to about 328 KB in the repo and in every image built from it.

Browser-support assumption: WOFF2 has shipped since Chrome 36, Firefox 39, Safari 10, and Edge 14
(2016). A browser too old for it would fail on far more of AFCT than the maths. To reverse the
decision, set `KEEP_FORMATS` in the script back to all three formats and re-run it.

The script verifies itself and exits non-zero if the stylesheet references a file it did not
write, if it wrote a file the stylesheet never references, or if a dropped format survived in the
CSS. `vendored-katex.test.ts` asserts the same properties against the committed copy, so a KaTeX
upgrade that renames a face fails in CI rather than silently rendering in a fallback font. Running
the script twice produces byte-identical output.

### KaTeX in the client bundle

**Nothing loads KaTeX until an equation needs it.** It is about 265 KB of JavaScript, most
descriptions contain no maths, and the read surfaces are client components, so a static import
put a typesetter on every route that shows a description. Three things keep it off them:

- `renderDescriptionMath` (`src/components/rich-description/render-math.ts`) fetches KaTeX through
  `loadMathRenderer()` instead of importing it. Until that resolves it declines to render, and the
  caller shows the LaTeX source.
- `DescriptionMath` asks for the renderer when the first equation mounts, and shows the source in
  a `<code>` until it arrives. It seeds its state from the module, so once loaded, later equations
  render on their first pass with no placeholder.
- `@/lib/rich-description` (the barrel) does not re-export `latex-parse` or `write`. Both reach
  KaTeX, and barrel re-exports are not tree-shaken here, so one import of any name pulled the
  whole typesetter into a client bundle. The two callers that genuinely parse LaTeX import from
  those modules directly.

**The editor is loaded on demand too**, for the same reason but a bigger one. The Tiptap maths
extension imports KaTeX outright, so the editor can never be KaTeX-free; on top of that it carries
ProseMirror and Tiptap. `RichDescriptionField` pulls it in with `next/dynamic` (`ssr: false`) when
a form that uses it is shown. Every description form goes through that field, so it is the only
place that needs to do this.

Together those took `/dashboard/courses/[id]` from about 1940 KB of client JavaScript to 1244 KB,
and `/dashboard/courses/[id]/[aid]`, the page students read, from 1841 KB to 1145 KB.

Two consequences worth knowing:

- **Server-rendered maths needs one line.** `renderDescriptionMath` is still synchronous and free
  of browser APIs, so a server surface can render equations, but it must `await loadMathRenderer()`
  once before rendering. Without that the HTML contains the LaTeX source.
  `RichDescription.server.test.tsx` shows both halves.
- **Tests that mount a description form should warm the module first**, with
  `warmRichDescriptionEditor()` from `src/test/rich-editor.ts`. The first load of the editor tree
  through the test transformer regularly outruns a default `waitFor` timeout, which otherwise fails
  whichever test happens to be first.

The dev-only `/dashboard/development-tests` page still bundles KaTeX eagerly: it imports the
editor directly, on purpose, since demonstrating the editor is the point of the page.

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
