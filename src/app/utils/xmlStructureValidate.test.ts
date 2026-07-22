import { describe, it, expect } from 'vitest';
import { validateStructureXML } from './xmlStructureValidate';

const validFa = '<structure><type>fa</type><automaton></automaton></structure>';

describe('validateStructureXML', () => {
  it('accepts a well-formed structure of the expected type', () => {
    expect(validateStructureXML(validFa, 'FA')).toEqual({ isValid: true });
  });

  it('maps CFG -> GRAMMAR and TM -> TURING', () => {
    expect(
      validateStructureXML('<structure><type>grammar</type></structure>', 'CFG'),
    ).toEqual({ isValid: true });
    expect(
      validateStructureXML('<structure><type>turing</type></structure>', 'TM'),
    ).toEqual({ isValid: true });
  });

  it('rejects a mismatched structure type', () => {
    const result = validateStructureXML(validFa, 'TM');
    expect(result.isValid).toBe(false);
  });

  it('rejects malformed XML', () => {
    const result = validateStructureXML('<structure><type>fa', 'FA');
    expect(result.isValid).toBe(false);
  });

  // XXE guard: a DOCTYPE/ENTITY declaration must be rejected before the file is ever
  // stored, since the downstream evaluator parses it with an unhardened XML parser.
  it('rejects a DOCTYPE declaration (XXE vector)', () => {
    const xxe =
      '<!DOCTYPE structure [ <!ENTITY x SYSTEM "file:///proc/self/cmdline"> ]>' +
      '<structure><type>fa</type><state>&x;</state></structure>';
    const result = validateStructureXML(xxe, 'FA');
    expect(result.isValid).toBe(false);
    if (!result.isValid) expect(result.error).toMatch(/DOCTYPE or ENTITY/);
  });

  it('rejects a bare ENTITY declaration regardless of case or spacing', () => {
    const payload =
      '<!doctype structure [ <! ENTITY evil SYSTEM "http://attacker/x"> ]>' +
      '<structure><type>fa</type></structure>';
    expect(validateStructureXML(payload, 'FA').isValid).toBe(false);
  });

  it('does not false-positive on a comment mentioning DOCTYPE (guard does not fire)', () => {
    const withComment =
      '<!-- no DOCTYPE here --><structure><type>fa</type></structure>';
    const result = validateStructureXML(withComment, 'FA');
    // The XXE guard must not trip on the word appearing inside a comment; if this input
    // is rejected at all it must be for some other reason, never the DOCTYPE/ENTITY error.
    if (!result.isValid) expect(result.error).not.toMatch(/DOCTYPE or ENTITY/);
  });
});
