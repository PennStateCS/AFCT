# Formatted descriptions

Assignments and problems both take a description, and both use the same editor. A description is
what a student reads before they start, so it is worth more than a sentence: state the language,
give an example string or two, and say what counts as a correct answer.

The editor is used in four places, and behaves the same in all of them:

- **Create Problem** and **Edit Problem**, on the Details step (see [Problems](problems.md)).
- **Create Assignment** and the assignment's own Details tab (see [Details](details.md)).

## The toolbar

Controls are grouped left to right. On a narrow window the groups that do not fit collapse into a
**More** menu at the end of the toolbar, so nothing is lost, it just moves.

| Group | What it does |
| --- | --- |
| Undo, Redo | Step backwards and forwards through your edits. |
| Text style | Paragraph, or Heading 2, 3 or 4 for the selected block. |
| Bold, Italic, Underline, Inline code | Formatting for the selected text. Inline code is for a symbol or a short string, like `0011`. |
| Link, Equation | Both open a small dialog. With the caret already inside a link or an equation, the same button edits it instead of adding a new one. |
| Bullet list, Numbered list, Quote, Code block, Horizontal rule | Block formatting. Code block is for a multi-line sample; inline code is for a fragment inside a sentence. |
| Text alignment | Left, centre or right for the selected block. |

Two buttons sit at the end and are always available, including when the description is read-only:
**Keyboard shortcuts**, which lists the shortcuts below, and **Expand editor**, which opens the
editor over the full window for writing something long. Collapsing it returns you to the form with
your work intact.

Headings start at Heading 2 on purpose. The page's own title is the first-level heading, so a
description that started at Heading 1 would compete with it and would read wrong to a screen
reader.

## Keyboard shortcuts

`Ctrl` is shown here; on macOS it is `Cmd`.

| Action | Keys |
| --- | --- |
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Shift+Z` |
| Bold | `Ctrl+B` |
| Italic | `Ctrl+I` |
| Underline | `Ctrl+U` |
| Inline code | `Ctrl+E` |
| Add or edit link | `Ctrl+K` |

## Equations

Select **Equation** to write mathematical notation in LaTeX. The dialog offers two modes:

- **Inline** sets the equation in the run of a sentence, for something like a transition or a
  short expression.
- **Display** puts it on its own centred line, which suits anything with a fraction, a large
  operator, or several aligned lines.

The dialog previews the equation as you type and reports an error rather than saving something
that will not render. Because the two modes are genuinely different LaTeX contexts, a few
constructs are valid in only one of them: multi-line environments such as `\begin{align}` are
display-only, and the dialog will say so if you try to use one inline.

Equations are stored as LaTeX and rendered when the description is displayed, so they stay
readable, searchable, and correct at any zoom level.

## Links

Select **Link** to attach a URL to the selected text. Link to material a student can reach:
anything behind a login they do not have is worse than no link. With the caret inside an existing
link, the same button reopens the dialog to edit or remove it.

## Pasting from Word or Google Docs

Pasting from another editor works, and AFCT deliberately keeps only the structure. Headings,
lists, bold, italic and alignment survive; fonts, sizes, colours, images and tables do not. This
is intentional: descriptions inherit the site's own styling so they stay legible in both light and
dark mode, and so a pasted colour cannot end up failing contrast for a student who needs it.

If a paste comes through flatter than you expected, apply the formatting again from the toolbar.
It is usually quicker than fighting the source document.

## What students see

The description is rendered wherever the assignment or problem is shown, including the student's
view of the assignment and the problem list. Write it for them.

Rendering never blanks the page. If an equation cannot be drawn, AFCT falls back to showing its
LaTeX source, and if a whole description fails it falls back to the plain text. The words always
reach the student, even when the formatting does not, so a bad equation costs legibility rather
than the assignment.
