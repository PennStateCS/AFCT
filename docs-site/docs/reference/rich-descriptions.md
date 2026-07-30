# Rich descriptions

Assignment and problem descriptions are edited in a rich-text editor and stored as versioned
Tiptap JSON. The plain-text description is kept alongside it, always, because other clients
depend on it. This page is the contract: what is stored, what is guaranteed, and what to do when
the format needs to change.

## Storage format

Three columns move together on both `Assignment` and `Problem`:

| Column | Purpose |
| --- | --- |
| `description` | Plain text. Never null when a description exists. The only form other clients receive. |
| `descriptionFormat` | `PLAIN_TEXT` or `TIPTAP_JSON`. Says which column is authoritative. |
| `descriptionJson` | The versioned rich document, or null. |

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

Equations are inserted and edited only through the equation dialog. The upstream extension's input
rules are removed on purpose: they map `$$x$$` to *inline* math and `$$$x$$$` to a display block,
which inverts what LaTeX authors expect and disagrees with how AFCT writes math into the plain-text
description. An expression KaTeX cannot parse is not saveable, because it would render as red
error text for every student.

Block equations are always centred. The upstream `blockMath` node is an atom carrying only its
LaTeX source, so there is nowhere to store a per-equation alignment; adding one would mean forking
the official node.

KaTeX's stylesheet and fonts are bundled with the app. They are never loaded from a CDN.

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
