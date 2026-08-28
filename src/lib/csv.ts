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
 * The formula-neutralizing half on its own, for an exporter that quotes elsewhere
 * (json2csv does its own quoting, so wrapping its input in a second pair breaks the file).
 */
export function neutralizeCsvFormula(text: string): string {
  return FORMULA_START.test(text) && !NUMERIC.test(text) ? `'${text}` : text;
}

/**
 * Walk a JSON-shaped value and neutralize every string in it, for handing a fetched
 * payload to a CSV library that only quotes. Arrays and plain objects are rebuilt;
 * everything else passes through untouched.
 */
export function neutralizeCsvFormulasDeep(value: unknown): unknown {
  if (typeof value === 'string') return neutralizeCsvFormula(value);
  if (Array.isArray(value)) return value.map(neutralizeCsvFormulasDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        neutralizeCsvFormulasDeep(v),
      ]),
    );
  }
  return value;
}

/**
 * Render one value as a quoted, formula-safe CSV cell.
 * Always returns a `"`-quoted field with inner quotes doubled, so embedded commas and
 * newlines are safe too.
 */
export function escapeCsvCell(value: unknown): string {
  const text = neutralizeCsvFormula(String(value ?? ''));
  return `"${text.replace(/"/g, '""')}"`;
}
