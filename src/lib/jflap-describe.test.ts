import { describe, expect, it } from 'vitest';
import { describeMachine, type Parsed } from './jflap-parse';

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
    const parsed: Parsed = {
      type: 'fa',
      states: [state('q0', { initial: true }), state('q1'), state('q2', { final: true })],
      // Deliberately out of order: __idx is what defines the file's order.
      transitions: [
        { from: 'q1', to: 'q2', read: 'b', __idx: 1 },
        { from: 'q0', to: 'q1', read: 'a', __idx: 0 },
        { from: 'q2', to: 'q2', read: 'a', __idx: 2 },
      ],
    };

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
    const parsed: Parsed = {
      type: 'fa',
      states: [state('q0', { initial: true })],
      transitions: [{ from: 'q0', to: 'q0', __idx: 0 }],
    };

    expect(describeMachine(parsed, 'ε').transitionLines).toEqual(['q0 to q0 on ε']);
  });

  it('includes stack and tape detail for PDA and TM labels', () => {
    const pda = describeMachine(
      {
        type: 'pda',
        states: [state('s0', { initial: true })],
        transitions: [{ from: 's0', to: 's0', read: 'a', pop: 'Z', push: 'AZ', __idx: 0 }],
      },
      'ε',
    );
    expect(pda.transitionLines).toEqual(['s0 to s0 on a , Z ; AZ']);

    const tm = describeMachine(
      {
        type: 'tm',
        states: [state('t0', { initial: true })],
        transitions: [{ from: 't0', to: 't0', read: '0', write: '1', move: 'r', __idx: 0 }],
      },
      'ε',
    );
    expect(tm.transitionLines).toEqual(['t0 to t0 on 0 → 1, R']);
  });

  it('reports a machine with no final state', () => {
    const d = describeMachine(
      { type: 'fa', states: [state('q0', { initial: true })], transitions: [] },
      'ε',
    );
    expect(d.finalStates).toEqual([]);
    expect(d.summary).toContain('No final states.');
    expect(d.summary).toContain('1 state and 0 transitions');
  });

  it('reports a missing initial state rather than pretending there is one', () => {
    const d = describeMachine({ type: 'fa', states: [state('q0')], transitions: [] }, 'ε');
    expect(d.initialState).toBeNull();
    expect(d.summary).toContain('Initial state not set.');
  });

  it('flags an empty machine', () => {
    const d = describeMachine({ type: 'fa', states: [], transitions: [] }, 'ε');
    expect(d.isEmpty).toBe(true);
    expect(d.summary).toBe('Finite automaton with no states.');
  });

  it('falls back to state ids when names are blank', () => {
    const d = describeMachine(
      {
        type: 'fa',
        states: [state('0', { name: '', initial: true }), state('1', { name: '' })],
        transitions: [{ from: '0', to: '1', read: 'x', __idx: 0 }],
      },
      'ε',
    );
    expect(d.stateNames).toEqual(['0', '1']);
    expect(d.transitionLines).toEqual(['0 to 1 on x']);
  });
});
