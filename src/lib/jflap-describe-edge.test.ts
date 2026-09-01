/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { parseJflap, describeEdge } from './jflap-parse';

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
