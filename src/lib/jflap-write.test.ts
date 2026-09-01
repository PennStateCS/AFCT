/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parseJflap } from './jflap-parse';
import { toJflapXml } from './jflap-write';

/**
 * The guarantee is the round trip: parsing what the writer produced must give back exactly
 * what the writer was given. That is the only assertion that catches a field quietly dropped
 * or a flag written in a form JFLAP would not read back.
 */
const roundTrip = (xml: string) => parseJflap(toJflapXml(parseJflap(xml)));

const FA = `<?xml version="1.0"?><structure><type>fa</type><automaton>
  <state id="0" name="q0"><x>120.0</x><y>80.0</y><initial/></state>
  <state id="1" name="q1"><x>300.0</x><y>80.0</y><final/></state>
  <transition><from>0</from><to>1</to><read>a</read></transition>
  <transition><from>1</from><to>1</to><read/></transition>
</automaton></structure>`;

const PDA = `<?xml version="1.0"?><structure><type>pda</type><automaton>
  <state id="0" name="q0"><x>10.0</x><y>20.0</y><initial/><final/></state>
  <transition><from>0</from><to>0</to><read>a</read><pop>Z</pop><push>AZ</push></transition>
</automaton></structure>`;

const TM = `<?xml version="1.0"?><structure><type>turing</type><automaton>
  <state id="0" name="q0"><x>10.0</x><y>20.0</y><initial/></state>
  <transition><from>0</from><to>0</to><read>a</read><write>b</write><move>R</move></transition>
</automaton></structure>`;

describe('toJflapXml', () => {
  it.each([
    ['a finite automaton', FA],
    ['a pushdown automaton', PDA],
    ['a Turing machine', TM],
  ])('round-trips %s', (_label, xml) => {
    expect(roundTrip(xml)).toEqual(parseJflap(xml));
  });

  it('round-trips a file JFLAP itself saved, notes and all', () => {
    // The fixture is a real JFLAP 7.1 save, which is the only thing that settles what the
    // format actually is. See the note about its CRLF line endings.
    const fixture = readFileSync(
      path.join(__dirname, '__fixtures__/jflap-notes-from-jflap.jff'),
      'utf8',
    );
    expect(roundTrip(fixture)).toEqual(parseJflap(fixture));
  });

  it('writes epsilon as an empty element, never as a symbol', () => {
    // A written epsilon character would be a machine that reads a literal epsilon, which is a
    // different and wrong machine.
    const xml = toJflapXml(parseJflap(FA));
    expect(xml).toContain('<read/>');
    expect(xml).not.toContain('ε');
  });

  it('keeps initial and final as bare flags', () => {
    const xml = toJflapXml(parseJflap(FA));
    expect(xml).toContain('<initial/>');
    expect(xml).toContain('<final/>');
  });

  it('preserves the order the transitions were declared in', () => {
    const parsed = parseJflap(FA);
    const written = parseJflap(toJflapXml(parsed));
    expect(written.transitions.map((t) => `${t.from}->${t.to}`)).toEqual(
      parsed.transitions.map((t) => `${t.from}->${t.to}`),
    );
  });

  it('escapes a state name that would otherwise break the XML', () => {
    const hostile = `<?xml version="1.0"?><structure><type>fa</type><automaton>
      <state id="0" name="q&amp;&lt;0&quot;"><x>0</x><y>0</y></state>
    </automaton></structure>`;
    expect(roundTrip(hostile).states[0]?.name).toBe('q&<0"');
  });

  it('writes a note break as CRLF, which is the only break JFLAP reads', () => {
    const withNote = `<?xml version="1.0"?><structure><type>fa</type><automaton>
      <note><text>first\r\nsecond</text><x>5.0</x><y>6.0</y></note>
    </automaton></structure>`;
    const xml = toJflapXml(parseJflap(withNote));
    expect(xml).toContain('first\r\nsecond');
    expect(roundTrip(withNote).notes[0]?.text).toBe('first\nsecond');
  });
});
