/**
 * CSV cell escaping, shared by every exporter.
 *
 * Quoting alone is not enough. Excel, LibreOffice and Google Sheets treat a cell whose
 * text begins with `=`, `+`, `-`, `@`, a tab or a carriage return as a *formula*, so a
 * user-controlled string such as a student's name set to `=HYPERLINK("http://evil","click")`
 * executes when an administrator opens the export. Prefixing with an apostrophe makes the
 * spreadsheet render it as literal text.
 *
 * Plain numbers are deliberately exempt: a grade of `-5` must stay numeric, and a leading
 * `-` on a number is not an injection vector.
 */

/** A spreadsheet treats a cell starting with any of these as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Plain (optionally negative, optionally decimal) numbers are safe data. */
const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * Render one value as a quoted, formula-safe CSV cell.
 * Always returns a `"`-quoted field with inner quotes doubled, so embedded commas and
 * newlines are safe too.
 */
export function escapeCsvCell(value: unknown): string {
  let text = String(value ?? '');
  if (FORMULA_START.test(text) && !NUMERIC.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
