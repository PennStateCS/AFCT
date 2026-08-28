import { describe, expect, it } from 'vitest';
import { escapeCsvCell, neutralizeCsvFormula, neutralizeCsvFormulasDeep } from './csv';

describe('escapeCsvCell', () => {
  it('quotes plain text and doubles inner quotes', () => {
    expect(escapeCsvCell('Ada Lovelace')).toBe('"Ada Lovelace"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('keeps commas and newlines inside the quoted field', () => {
    expect(escapeCsvCell('Lovelace, Ada')).toBe('"Lovelace, Ada"');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralizes every formula lead-in a spreadsheet would execute', () => {
    // The attack: a student sets their name (or a course title) to a formula, an admin
    // exports the table and opens it in Excel/Sheets.
    expect(escapeCsvCell('=HYPERLINK("http://evil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""click"")"',
    );
    expect(escapeCsvCell('+1+1')).toBe('"\'+1+1"');
    expect(escapeCsvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(escapeCsvCell('\tcmd')).toBe('"\'\tcmd"');
    expect(escapeCsvCell('\rcmd')).toBe('"\'\rcmd"');
    expect(escapeCsvCell('-2+3+cmd|calc')).toBe('"\'-2+3+cmd|calc"');
  });

  it('leaves real numbers numeric, including negatives and decimals', () => {
    // A grade of -5 must not become the text '-5.
    expect(escapeCsvCell(-5)).toBe('"-5"');
    expect(escapeCsvCell('-5')).toBe('"-5"');
    expect(escapeCsvCell('-12.75')).toBe('"-12.75"');
    expect(escapeCsvCell(0)).toBe('"0"');
  });

  it('renders null and undefined as an empty field', () => {
    expect(escapeCsvCell(null)).toBe('""');
    expect(escapeCsvCell(undefined)).toBe('""');
  });
});

describe('neutralizeCsvFormula', () => {
  it('prefixes a formula lead-in without adding quotes', () => {
    // The quoting is the CSV library's job on this path; a second pair would corrupt it.
    expect(neutralizeCsvFormula('=HYPERLINK("http://evil","x")')).toBe(
      '\'=HYPERLINK("http://evil","x")',
    );
  });

  it('leaves ordinary text and real numbers alone', () => {
    expect(neutralizeCsvFormula('Ada Lovelace')).toBe('Ada Lovelace');
    expect(neutralizeCsvFormula('-5')).toBe('-5');
  });
});

describe('neutralizeCsvFormulasDeep', () => {
  /**
   * The shape the System Logs export hands to json2csv: rows whose strings a user can
   * influence (their own name, their User-Agent header, metadata values). Every string
   * at every depth must come back neutralized, and nothing else may change.
   */
  it('neutralizes strings at every depth and preserves the rest', () => {
    expect(
      neutralizeCsvFormulasDeep([
        {
          userFirstName: '=2+2',
          userAgent: '@SUM(A1:A9)',
          count: 3,
          flag: true,
          nothing: null,
          metadata: { reason: '+cmd', list: ['-x', 'ok'] },
        },
      ]),
    ).toEqual([
      {
        userFirstName: "'=2+2",
        userAgent: "'@SUM(A1:A9)",
        count: 3,
        flag: true,
        nothing: null,
        metadata: { reason: "'+cmd", list: ["'-x", 'ok'] },
      },
    ]);
  });
});
