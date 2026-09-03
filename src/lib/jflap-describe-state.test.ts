/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { parseJflap, describeState } from './jflap-parse';

const FA = parseJflap(`<?xml version="1.0"?><structure><type>fa</type><automaton>
  <state id="0" name="q0"><x>0</x><y>0</y><initial/></state>
  <state id="1" name="q1"><x>0</x><y>0</y><final/></state>
  <transition><from>0</from><to>1</to><read>a</read></transition>
  <transition><from>1</from><to>1</to><read>b</read></transition>
  <transition><from>1</from><to>0</to><read/></transition>
</automaton></structure>`);

describe('describeState', () => {
  it('reports what the state is', () => {
    const q0 = describeState(FA, '0', 'ε');
    expect(q0?.name).toBe('q0');
    expect(q0?.initial).toBe(true);
    expect(q0?.final).toBe(false);
  });

  it('separates what leaves from what arrives, and names the other end', () => {
    const q0 = describeState(FA, '0', 'ε');
    expect(q0?.outgoing).toEqual(['on a to q1']);
    expect(q0?.incoming).toEqual(['from q1 on ε']);
  });

  it('shows a self-loop on both sides, because it is both', () => {
    const q1 = describeState(FA, '1', 'ε');
    expect(q1?.outgoing).toContain('on b to q1');
    expect(q1?.incoming).toContain('from q1 on b');
  });

  it('counts each transition once, even the self-loop', () => {
    // Three transitions touch q1: the one in from q0, its own loop, and the one out to q0.
    expect(describeState(FA, '1', 'ε')?.degree).toBe(3);
  });

  it('uses the empty-string symbol the course chose', () => {
    expect(describeState(FA, '0', 'λ')?.incoming).toEqual(['from q1 on λ']);
  });

  it('returns null for something that is not a state', () => {
    // What a click on a note or the start marker produces. The caller shows nothing rather
    // than a panel full of blanks.
    expect(describeState(FA, 'jff-note-0', 'ε')).toBeNull();
  });

  it('falls back to the id when a state has no name', () => {
    const unnamed = parseJflap(`<?xml version="1.0"?><structure><type>fa</type><automaton>
      <state id="7"><x>0</x><y>0</y></state>
    </automaton></structure>`);
    expect(describeState(unnamed, '7', 'ε')?.name).toBeTruthy();
  });
});

describe("a state's transitions, as its panel lists them", () => {
  it('gives each one its two ends, so a row can open that transition', () => {
    const q0 = describeState(FA, '0', 'ε');
    expect(q0?.links).toEqual([
      { direction: 'out', from: '0', to: '1', other: 'q1', label: 'a' },
      { direction: 'in', from: '1', to: '0', other: 'q1', label: 'ε' },
    ]);
  });

  it('lists a self-loop once rather than as both a departure and an arrival', () => {
    // It leaves and arrives at the same state; two rows would read as two transitions.
    const q1 = describeState(FA, '1', 'ε');
    const loops = q1?.links.filter((link) => link.from === '1' && link.to === '1');
    expect(loops).toHaveLength(1);
    expect(loops?.[0]?.direction).toBe('out');
  });

  it('keeps the order the file declares, which is the order the drawing uses', () => {
    const q1 = describeState(FA, '1', 'ε');
    expect(q1?.links.map((link) => link.label)).toEqual(['a', 'b', 'ε']);
  });
});
