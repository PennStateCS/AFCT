import { describe, expect, it } from 'vitest';
import { submissionByteHash, submissionContentHash, submissionShapeHash } from './content-hash';

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

describe('submissionShapeHash', () => {
  // The two easiest things to do to a file somebody handed you.
  it('is the same after the states are dragged somewhere else', () => {
    expect(submissionShapeHash(fa({ x: '900.0' }))).toBe(submissionShapeHash(fa()));
  });

  it('is the same after the states are renamed', () => {
    const renamed = fa().replace('name="q0"', 'name="start"');
    expect(submissionShapeHash(renamed)).toBe(submissionShapeHash(fa()));
  });

  it('changes when the machine itself changes', () => {
    const extraTransition = fa().replace(
      '</automaton>',
      '<transition><from>0</from><to>0</to><read>b</read></transition></automaton>',
    );
    expect(submissionShapeHash(extraTransition)).not.toBe(submissionShapeHash(fa()));
  });

  it('separates an accepting state from an ordinary one', () => {
    const accepting = fa().replace('<initial/>', '<initial/><final/>');
    expect(submissionShapeHash(accepting)).not.toBe(submissionShapeHash(fa()));
  });

  it('does not care what order the productions of a grammar were written in', () => {
    const one =
      '<structure><type>grammar</type><production><left>S</left><right>aSb</right></production><production><left>S</left><right>ab</right></production></structure>';
    const other =
      '<structure><type>grammar</type><production><left>S</left><right>ab</right></production><production><left>S</left><right>aSb</right></production></structure>';

    expect(submissionShapeHash(one)).toBe(submissionShapeHash(other));
    // ...and the exact fingerprint still tells them apart, which is the difference between
    // "the same file" and "the same work".
    expect(submissionContentHash(one)).not.toBe(submissionContentHash(other));
  });

  it('has nothing to say about a file with no structure to speak of', () => {
    expect(submissionShapeHash('(a|b)*abb')).toBeNull();
    expect(submissionShapeHash('<structure><type>re</type><expression>a*</expression></structure>')).toBeNull();
  });
});

describe('submissionByteHash', () => {
  it('is stable for the same bytes', () => {
    expect(submissionByteHash(fa())).toBe(submissionByteHash(fa()));
    expect(submissionByteHash(fa())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates files the other fingerprints deliberately treat as one', () => {
    // The case this exists for: same work, same normalised contents, different files. The
    // exact fingerprint says these are the same; only this one can say they are not.
    const plain = fa();
    const windows = fa({ crlf: true });
    const commented = fa({ comment: '<!--Created with JFLAP 7.1.-->' });

    expect(submissionContentHash(windows)).toBe(submissionContentHash(plain));
    expect(submissionContentHash(commented)).toBe(submissionContentHash(plain));
    expect(submissionByteHash(windows)).not.toBe(submissionByteHash(plain));
    expect(submissionByteHash(commented)).not.toBe(submissionByteHash(plain));
  });

  it('agrees whenever the bytes agree, which is what makes it safe to report', () => {
    // Identical bytes must normalise identically, or the tab could say two files are the same
    // file while grouping them apart. Buffer and string spellings of the same content too.
    expect(submissionByteHash(Buffer.from(fa(), 'utf8'))).toBe(submissionByteHash(fa()));
    expect(submissionContentHash(Buffer.from(fa(), 'utf8'))).toBe(submissionContentHash(fa()));
  });

  it('has nothing to say about an empty file', () => {
    expect(submissionByteHash(Buffer.alloc(0))).toBeNull();
    expect(submissionByteHash('')).toBeNull();
    // Whitespace is still bytes somebody sent, unlike the normalising fingerprints.
    expect(submissionByteHash('   ')).toMatch(/^[0-9a-f]{64}$/);
    expect(submissionContentHash('   ')).toBeNull();
  });
});
