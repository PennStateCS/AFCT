import { describe, expect, it } from 'vitest';
import { describeMachine, type Parsed } from './jflap-parse';

/** A parsed machine, with the fields a case does not care about filled in. */
const machine = (o: Partial<Parsed> & Pick<Parsed, 'type'>): Parsed => ({
  states: [],
  transitions: [],
  notes: [],
  ...o,
});

const state = (id: string, o: Partial<Parsed['states'][number]> = {}) => ({
  id,
  name: id,
  xPos: 0,
  yPos: 0,
  initial: false,
  final: false,
  ...o,
});

describe('describeMachine', () => {
  it('describes a finite automaton in reading order', () => {
    const parsed: Parsed = machine({
      type: 'fa',
      states: [state('q0', { initial: true }), state('q1'), state('q2', { final: true })],
      // Deliberately out of order: __idx is what defines the file's order.
      transitions: [
        { from: 'q1', to: 'q2', read: 'b', __idx: 1 },
        { from: 'q0', to: 'q1', read: 'a', __idx: 0 },
        { from: 'q2', to: 'q2', read: 'a', __idx: 2 },
      ],
    });

    const d = describeMachine(parsed, 'ε');

    expect(d.initialState).toBe('q0');
    expect(d.finalStates).toEqual(['q2']);
    expect(d.stateNames).toEqual(['q0', 'q1', 'q2']);
    expect(d.transitionLines).toEqual(['q0 to q1 on a', 'q1 to q2 on b', 'q2 to q2 on a']);
    expect(d.summary).toBe(
      'Finite automaton with 3 states and 3 transitions. Initial state q0. Final state q2.',
    );
    expect(d.isEmpty).toBe(false);
  });

  it('uses the epsilon symbol for an empty read', () => {
    const parsed: Parsed = machine({
      type: 'fa',
      states: [state('q0', { initial: true })],
      transitions: [{ from: 'q0', to: 'q0', __idx: 0 }],
    });

    expect(describeMachine(parsed, 'ε').transitionLines).toEqual(['q0 to q0 on ε']);
  });

  it('includes stack and tape detail for PDA and TM labels', () => {
    const pda = describeMachine(
      machine({
        type: 'pda',
        states: [state('s0', { initial: true })],
        transitions: [{ from: 's0', to: 's0', read: 'a', pop: 'Z', push: 'AZ', __idx: 0 }],
      }),
      'ε',
    );
    expect(pda.transitionLines).toEqual(['s0 to s0 on a , Z ; AZ']);

    const tm = describeMachine(
      machine({
        type: 'tm',
        states: [state('t0', { initial: true })],
        transitions: [{ from: 't0', to: 't0', read: '0', write: '1', move: 'r', __idx: 0 }],
      }),
      'ε',
    );
    expect(tm.transitionLines).toEqual(['t0 to t0 on 0 → 1, R']);
  });

  it('reports a machine with no final state', () => {
    const d = describeMachine(
      machine({ type: 'fa', states: [state('q0', { initial: true })] }),
      'ε',
    );
    expect(d.finalStates).toEqual([]);
    expect(d.summary).toContain('No final states.');
    expect(d.summary).toContain('1 state and 0 transitions');
  });

  it('reports a missing initial state rather than pretending there is one', () => {
    const d = describeMachine(machine({ type: 'fa', states: [state('q0')] }), 'ε');
    expect(d.initialState).toBeNull();
    expect(d.summary).toContain('Initial state not set.');
  });

  it('flags an empty machine', () => {
    const d = describeMachine(machine({ type: 'fa' }), 'ε');
    expect(d.isEmpty).toBe(true);
    expect(d.summary).toBe('Finite automaton with no states.');
  });

  it('falls back to state ids when names are blank', () => {
    const d = describeMachine(
      machine({
        type: 'fa',
        states: [state('0', { name: '', initial: true }), state('1', { name: '' })],
        transitions: [{ from: '0', to: '1', read: 'x', __idx: 0 }],
      }),
      'ε',
    );
    expect(d.stateNames).toEqual(['0', '1']);
    expect(d.transitionLines).toEqual(['0 to 1 on x']);
  });

  /**
   * Notes are content, not decoration. The Similarity tab can tell a professor that text on two
   * drawings matches word for word, so somebody reading this instead of the picture has to be
   * able to read the text that claim is about.
   */
  describe('notes written on the drawing', () => {
    const withNotes = (texts: string[]) =>
      describeMachine(
        machine({
          type: 'fa',
          states: [state('q0', { initial: true })],
          notes: texts.map((text, i) => ({ text, xPos: i * 10, yPos: 0 })),
        }),
        'ε',
      );

    it('lists each note', () => {
      expect(withNotes(['see the loop', 'not sure about q1']).noteLines).toEqual([
        'see the loop',
        'not sure about q1',
      ]);
    });

    /**
     * The summary is the whole of what `aria-describedby` gives the canvas, so a screen-reader
     * user who never expands the detail is otherwise not told the notes exist at all.
     */
    it('says how many there are in the summary', () => {
      expect(withNotes(['one']).summary).toContain('1 note written on the drawing.');
      expect(withNotes(['one', 'two']).summary).toContain('2 notes written on the drawing.');
    });

    it('says nothing about notes when there are none', () => {
      expect(withNotes([]).summary).not.toContain('note');
      expect(withNotes([]).noteLines).toEqual([]);
    });

    // JFLAP notes are multi-line text areas. One note stays one entry in the list.
    it('flattens a multi-line note onto one line', () => {
      expect(withNotes(['first line\nsecond line']).noteLines).toEqual(['first line second line']);
    });

    /**
     * A file with a note and no states is a real thing, not a hypothetical: the repo's own
     * `Hw-00-incorrect-answer-2.jff` is exactly that. Calling it empty would hide the only
     * content it has.
     */
    it('is not empty when it holds notes but no states', () => {
      const d = describeMachine(
        machine({ type: 'fa', notes: [{ text: 'Hi', xPos: 0, yPos: 0 }] }),
        'ε',
      );
      expect(d.isEmpty).toBe(false);
      expect(d.noteLines).toEqual(['Hi']);
      expect(d.summary).toContain('1 note written on the drawing.');
    });
  });
});
