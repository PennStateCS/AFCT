/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { parseJflap, describeEdge, transitionFields } from './jflap-parse';

const FA = parseJflap(`<?xml version="1.0"?><structure><type>fa</type><automaton>
  <state id="0" name="q0"><x>0</x><y>0</y><initial/></state>
  <state id="1" name="q1"><x>0</x><y>0</y><final/></state>
  <transition><from>0</from><to>1</to><read>a</read></transition>
  <transition><from>0</from><to>1</to><read>b</read></transition>
  <transition><from>1</from><to>1</to><read/></transition>
</automaton></structure>`);

describe('describeEdge', () => {
  it('reports every transition drawn as that one edge, not just the first', () => {
    // Parallel transitions are bundled into a single line on the canvas. A panel showing only
    // one would be wrong on exactly the machines where this matters.
    const edge = describeEdge(FA, '0', '1', 'ε');
    expect(edge?.labels).toEqual(['a', 'b']);
  });

  it('names both ends by their state names, not their ids', () => {
    const edge = describeEdge(FA, '0', '1', 'ε');
    expect(edge?.from).toBe('q0');
    expect(edge?.to).toBe('q1');
  });

  it('marks a self-loop as one', () => {
    expect(describeEdge(FA, '1', '1', 'ε')?.selfLoop).toBe(true);
    expect(describeEdge(FA, '0', '1', 'ε')?.selfLoop).toBe(false);
  });

  it('uses the empty-string symbol the course chose', () => {
    expect(describeEdge(FA, '1', '1', 'λ')?.labels).toEqual(['λ']);
  });

  it('returns null when nothing joins the two states', () => {
    expect(describeEdge(FA, '1', '0', 'ε')).toBeNull();
  });

  it('keeps the order the file declared', () => {
    expect(describeEdge(FA, '0', '1', 'ε')?.labels).toEqual(['a', 'b']);
  });
});

describe('the parts of a transition, for a panel that can change them', () => {
  const PDA = parseJflap(`<?xml version="1.0"?><structure><type>pda</type><automaton>
  <state id="0" name="q0"><x>0</x><y>0</y><initial/></state>
  <state id="1" name="q1"><x>0</x><y>0</y><final/></state>
  <transition><from>0</from><to>1</to><read>a</read><pop>Z</pop><push>AZ</push></transition>
</automaton></structure>`);

  const TM = parseJflap(`<?xml version="1.0"?><structure><type>turing</type><automaton>
  <state id="0" name="q0"><x>0</x><y>0</y><initial/></state>
  <state id="1" name="q1"><x>0</x><y>0</y><final/></state>
  <transition><from>0</from><to>1</to><read>a</read><write>b</write><move>R</move></transition>
</automaton></structure>`);

  it('carries each transition in its parts, alongside the label the drawing shows', () => {
    const edge = describeEdge(FA, '0', '1', 'ε');
    expect(edge?.transitions.map((t) => t.read)).toEqual(['a', 'b']);
    expect(edge?.transitions.map((t) => t.label)).toEqual(edge?.labels);
    // The place in the file, which is what tells two transitions between the same pair apart.
    expect(edge?.transitions.map((t) => t.index)).toEqual([0, 1]);
  });

  it('gives a pushdown automaton what it pops and pushes', () => {
    const edge = describeEdge(PDA, '0', '1', 'ε');
    expect(edge?.transitions[0]).toMatchObject({ read: 'a', pop: 'Z', push: 'AZ' });
    expect(edge?.transitions[0]).not.toHaveProperty('write');
  });

  it('gives a Turing machine what it writes and which way it moves', () => {
    const edge = describeEdge(TM, '0', '1', 'ε');
    expect(edge?.transitions[0]).toMatchObject({ read: 'a', write: 'b', move: 'R' });
    expect(edge?.transitions[0]).not.toHaveProperty('pop');
  });

  it('says which fields each machine has, so a panel offers those and no others', () => {
    expect(transitionFields('fa')).toEqual(['read']);
    expect(transitionFields('pda')).toEqual(['read', 'pop', 'push']);
    expect(transitionFields('tm')).toEqual(['read', 'write', 'move']);
    // A file whose type nobody recognises still reads a symbol.
    expect(transitionFields('unknown')).toEqual(['read']);
  });
});
