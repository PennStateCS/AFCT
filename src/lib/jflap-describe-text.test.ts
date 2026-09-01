import { describe, it, expect } from 'vitest';
import { machineDescriptionText, type MachineDescription } from './jflap-parse';

const base: MachineDescription = {
  summary: 'Finite automaton with 2 states and 2 transitions. Initial state q0. Final state q1.',
  stateNames: ['q0', 'q1'],
  initialState: 'q0',
  finalStates: ['q1'],
  transitionLines: ['q0 to q1 on a', 'q1 to q1 on b'],
  noteLines: [],
  isEmpty: false,
};

/**
 * The text export exists so a machine can be quoted. A picture of an automaton cannot be
 * answered inline in an email or a comment; this can.
 */
describe('machineDescriptionText', () => {
  it('leads with the summary, then the parts a reader needs to rebuild the machine', () => {
    const text = machineDescriptionText(base);
    expect(text.startsWith(base.summary)).toBe(true);
    expect(text).toContain('States: q0, q1');
    expect(text).toContain('Initial state: q0');
    expect(text).toContain('Final states: q1');
    expect(text).toContain('  q0 to q1 on a');
  });

  it('says "none" rather than leaving final states blank', () => {
    // A blank reads as missing information; "none" is the actual answer and is a real case,
    // since a machine with no accepting state is a common wrong answer worth quoting.
    const text = machineDescriptionText({ ...base, finalStates: [] });
    expect(text).toContain('Final states: none');
  });

  it('says the initial state is not set when there is none', () => {
    const text = machineDescriptionText({ ...base, initialState: null });
    expect(text).toContain('Initial state: not set');
  });

  it("quotes the student's notes rather than counting them", () => {
    // The notes are the student's own words and the reason someone quotes a machine at all.
    const text = machineDescriptionText({ ...base, noteLines: ['not sure about the loop'] });
    expect(text).toContain('Notes on the drawing:');
    expect(text).toContain('  not sure about the loop');
  });

  it('omits the sections that have nothing in them', () => {
    const text = machineDescriptionText({
      summary: 'Finite automaton with no states.',
      stateNames: [],
      initialState: null,
      finalStates: [],
      transitionLines: [],
      noteLines: [],
      isEmpty: true,
    });
    expect(text).not.toContain('Transitions:');
    expect(text).not.toContain('States:');
    expect(text.trim()).toBe('Finite automaton with no states.');
  });
});
