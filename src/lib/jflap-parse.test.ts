/** @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import {
  parseJflap,
  labelFor,
  wrapLines,
  bundleEdges,
  toElements,
  POSITION_SCALE,
} from './jflap-parse';
import { NODE_DIAMETER, type Point } from './jflap-layout';

const faXml = `
<structure>
  <type>fa</type>
  <automaton>
    <state id="0" name="q0"><x>10</x><y>20</y><initial/></state>
    <state id="1" name="q1"><x>100</x><y>20</y><final/></state>
    <transition><from>0</from><to>1</to><read>a</read></transition>
    <transition><from>0</from><to>1</to><read>b</read></transition>
    <transition><from>1</from><to>1</to><read></read></transition>
  </automaton>
</structure>`;

describe('parseJflap', () => {
  it('parses states and transitions from a finite-automaton file', () => {
    const parsed = parseJflap(faXml);
    expect(parsed.type).toBe('fa');
    expect(parsed.states).toHaveLength(2);
    expect(parsed.states[0]).toMatchObject({
      id: '0',
      name: 'q0',
      xPos: 10,
      yPos: 20,
      initial: true,
      final: false,
    });
    expect(parsed.states[1]).toMatchObject({ id: '1', initial: false, final: true });
    expect(parsed.transitions).toHaveLength(3);
    expect(parsed.transitions[0]).toMatchObject({ from: '0', to: '1', read: 'a', __idx: 0 });
  });

  it('detects the machine type from the <type> tag', () => {
    expect(parseJflap('<structure><type>turing</type><automaton/></structure>').type).toBe('tm');
    expect(parseJflap('<structure><type>pda</type><automaton/></structure>').type).toBe('pda');
    expect(parseJflap('<structure><type>mystery</type><automaton/></structure>').type).toBe(
      'unknown',
    );
  });

  it('throws a friendly error on malformed XML', () => {
    expect(() => parseJflap('<structure><oops')).toThrow(/Invalid JFLAP/);
  });
});

describe('labelFor', () => {
  const tr = (over: Record<string, unknown> = {}) => ({ from: 'a', to: 'b', __idx: 0, ...over });

  it('uses eps for an empty FA read symbol', () => {
    expect(labelFor(tr({ read: '' }), 'fa', 'ε')).toBe('ε');
    expect(labelFor(tr({ read: 'x' }), 'fa', 'ε')).toBe('x');
  });

  it('formats a PDA transition as read , pop ; push with eps fallbacks', () => {
    expect(labelFor(tr({ read: 'a', pop: 'Z', push: 'AZ' }), 'pda', 'ε')).toBe('a , Z ; AZ');
    expect(labelFor(tr({}), 'pda', 'ε')).toBe('ε , ε ; ε');
  });

  it('formats a TM transition as read → write, move', () => {
    expect(labelFor(tr({ read: '0', write: '1', move: 'r' }), 'tm', 'ε')).toBe('0 → 1, R');
  });
});

describe('wrapLines', () => {
  it('leaves short lines untouched', () => {
    expect(wrapLines(['short'], 26)).toEqual(['short']);
  });

  it('breaks a long line on a separator', () => {
    const out = wrapLines(['aaaaaaaaaaaaaaa, bbbbbbbbbbbbbbb, ccccccccccccccc'], 26);
    expect(out.length).toBeGreaterThan(1);
    expect(out.join(' ')).toContain('aaaaaaaaaaaaaaa');
  });
});

describe('bundleEdges', () => {
  it('groups transitions between the same pair, newest label first', () => {
    const parsed = parseJflap(faXml);
    const bundled = bundleEdges(parsed.transitions, parsed.type, 'ε');
    const zeroToOne = bundled.find((e) => e.from === '0' && e.to === '1');
    // Two transitions 0→1 ('a' then 'b'); JFLAP shows the later one first.
    expect(zeroToOne?.label).toBe('b\na');
    // The empty self-loop read becomes eps.
    const loop = bundled.find((e) => e.from === '1' && e.to === '1');
    expect(loop?.label).toBe('ε');
  });
});

describe('toElements', () => {
  it('emits a node per state and a bundled edge per state-pair', () => {
    const parsed = parseJflap(faXml);
    const els = toElements(parsed, 'ε');
    const nodes = els.filter((e) => 'classes' in e);
    const edges = els.filter((e) => !('classes' in e));
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(2); // 0→1 (bundled) and 1→1
    const loop = edges.find((e) => 'isLoop' in e.data && e.data.isLoop === 1);
    expect(loop).toBeTruthy();
  });

  it('includes positions only when honorPositions is set', () => {
    const parsed = parseJflap(faXml);
    const withPos = toElements(parsed, 'ε', true).find((e) => 'position' in e) as
      | { position?: { x: number; y: number } }
      | undefined;
    // Opened out from the coordinates in the file, which were laid out around JFLAP's
    // smaller states; see POSITION_SCALE.
    expect(withPos?.position).toEqual({ x: 10 * POSITION_SCALE, y: 20 * POSITION_SCALE });

    const withoutPos = toElements(parsed, 'ε', false).some((e) => 'position' in e);
    expect(withoutPos).toBe(false);
  });

  it('opens the machine out enough for this viewer to draw a bigger state', () => {
    // The gaps in a .jff were sized for JFLAP's 40px state. Anything less than the ratio
    // between that and the state this viewer draws leaves labels running into circles.
    expect(POSITION_SCALE).toBeCloseTo(NODE_DIAMETER / 40);
    expect(POSITION_SCALE).toBeGreaterThan(1);
  });

  it('keeps the arrangement the author drew, scaling every state by the same amount', () => {
    const parsed = parseJflap(faXml);
    const positions = (toElements(parsed, 'ε', true) as Array<{ position?: Point }>)
      .map((e) => e.position)
      .filter((p): p is Point => !!p);

    // A uniform scale, so every state stays in the same place relative to the others.
    for (const [i, p] of positions.entries()) {
      const state = parsed.states[i]!;
      expect(p.x).toBeCloseTo(state.xPos * POSITION_SCALE);
      expect(p.y).toBeCloseTo(state.yPos * POSITION_SCALE);
    }
  });
});
