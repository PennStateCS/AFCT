import { describe, expect, it } from 'vitest';
import { submissionContentHash } from './content-hash';

const fa = (opts: { x?: string; comment?: string; crlf?: boolean; trailing?: string } = {}) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>${opts.comment ?? ''}<structure>
\t<type>fa</type>
\t<automaton>
\t\t<state id="0" name="q0">
\t\t\t<x>${opts.x ?? '134.0'}</x>
\t\t\t<y>111.0</y>
\t\t\t<initial/>
\t\t</state>
\t</automaton>
</structure>${opts.trailing ?? ''}`;
  return opts.crlf ? xml.replace(/\n/g, '\r\n') : xml;
};

describe('submissionContentHash', () => {
  it('is stable for the same file', () => {
    expect(submissionContentHash(fa())).toBe(submissionContentHash(fa()));
    expect(submissionContentHash(fa())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores everything outside the structure element', () => {
    const plain = submissionContentHash(fa());
    // JFLAP's own banner, and the hash comments the native client appends after the file.
    expect(submissionContentHash(fa({ comment: '<!--Created with JFLAP 7.1.-->' }))).toBe(plain);
    expect(
      submissionContentHash(fa({ trailing: '\n<!--<hashE>abc</hashE>-->\n<!--<hashD>def</hashD>-->' })),
    ).toBe(plain);
  });

  it('survives a round trip through a Windows editor', () => {
    expect(submissionContentHash(fa({ crlf: true }))).toBe(submissionContentHash(fa()));
  });

  it('changes when the automaton changes, including where a state sits', () => {
    // Layout is part of the fingerprint on purpose: two students who draw the same correct
    // machine almost never place it identically, and that is what separates a copied file
    // from a shared answer.
    expect(submissionContentHash(fa({ x: '135.0' }))).not.toBe(submissionContentHash(fa()));
  });

  it('accepts a Buffer as readily as a string', () => {
    expect(submissionContentHash(Buffer.from(fa(), 'utf8'))).toBe(submissionContentHash(fa()));
  });

  it('hashes a grammar with no layout at all', () => {
    const grammar = `<?xml version="1.0"?><structure><type>grammar</type>
      <production><left>S</left><right>aSb</right></production></structure>`;
    const sameGrammarDifferentSpacing =
      '<structure><type>grammar</type><production><left>S</left><right>aSb</right></production></structure>';

    expect(submissionContentHash(grammar)).toBe(submissionContentHash(sameGrammarDifferentSpacing));
  });

  it('keeps whitespace that is part of a value', () => {
    const spaced = '<structure><type>grammar</type><production><left>S</left><right>a S b</right></production></structure>';
    const tight = '<structure><type>grammar</type><production><left>S</left><right>aSb</right></production></structure>';

    expect(submissionContentHash(spaced)).not.toBe(submissionContentHash(tight));
  });

  it('falls back to normalised text for a file that is not JFLAP XML', () => {
    expect(submissionContentHash('(a|b)*abb\r\n')).toBe(submissionContentHash('(a|b)*abb   \n\n'));
    expect(submissionContentHash('(a|b)*abb')).not.toBe(submissionContentHash('(a|b)*abba'));
  });

  it('has nothing to say about an empty file', () => {
    expect(submissionContentHash('')).toBeNull();
    expect(submissionContentHash('   \n  ')).toBeNull();
  });
});
