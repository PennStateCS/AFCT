/** @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
      { position?: { x: number; y: number } } | undefined;
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

/**
 * Notes are the text a student wrote on the canvas. JFLAP writes them as
 * `<note><text>..</text><x>..</x><y>..</y></note>` and nothing else: `automata/Note` in the
 * evaluator jar persists no id, size or colour, so text plus a point is the whole of it.
 */
describe('notes', () => {
  const withNote = (inner: string) => `
<structure>
  <type>fa</type>
  <automaton>
    <state id="0" name="q0"><x>10</x><y>20</y><initial/></state>
    ${inner}
  </automaton>
</structure>`;

  it('reads the text and the position', () => {
    const parsed = parseJflap(
      withNote('<note><text>watch the loop</text><x>12.5</x><y>40</y></note>'),
    );
    expect(parsed.notes).toEqual([{ text: 'watch the loop', xPos: 12.5, yPos: 40 }]);
  });

  // JFLAP writes coordinates as floats. parseInt would truncate 12.5 to 12 by accident.
  it('keeps fractional coordinates', () => {
    const parsed = parseJflap(withNote('<note><text>x</text><x>0.5</x><y>0.25</y></note>'));
    expect(parsed.notes[0]).toMatchObject({ xPos: 0.5, yPos: 0.25 });
  });

  // A real break in a JFLAP note arrives as CRLF and is one line break.
  it('reads a CRLF as a single line break', () => {
    const parsed = parseJflap(
      withNote('<note><text>first&#13;\nsecond</text><x>0</x><y>0</y></note>'),
    );
    expect(parsed.notes[0]?.text).toBe('first\nsecond');
  });

  /**
   * A lone carriage return is not a line break to JFLAP: `properly&#13;and` renders as
   * "properlyand" in its own editor, joined and with no space. Checked by opening the same
   * file in JFLAP and in AFCT side by side, because nothing in the format says so.
   */
  it('drops a lone carriage return, as JFLAP does when it draws one', () => {
    const parsed = parseJflap(
      withNote('<note><text>properly&#13;and</text><x>0</x><y>0</y></note>'),
    );
    expect(parsed.notes[0]?.text).toBe('properlyand');
  });

  it('drops a note the student opened and never wrote in', () => {
    const parsed = parseJflap(withNote('<note><text>   </text><x>0</x><y>0</y></note>'));
    expect(parsed.notes).toEqual([]);
  });

  /**
   * Better to lose a note than to draw it at the origin, where it would sit on top of whatever
   * is there and look like the student put it beside that state deliberately.
   */
  it('drops a note with no usable position rather than placing it at the origin', () => {
    const parsed = parseJflap(withNote('<note><text>somewhere</text></note>'));
    expect(parsed.notes).toEqual([]);
  });

  /**
   * A file saved by JFLAP 7.1 itself, rather than XML written here to look like one.
   *
   * It is the only way to be sure how a real note is serialised, and it settled two questions
   * that reading the format could not: a line break inside a note is written as a literal CRLF
   * within `<text>`, and a `&#13;` entity is something else entirely, which JFLAP draws as
   * nothing at all. The two appear side by side in this file, which is why it is kept whole
   * instead of reduced to the interesting lines.
   */
  it('reads notes out of a file saved by JFLAP', () => {
    const xml = readFileSync(join(__dirname, '__fixtures__', 'jflap-notes-from-jflap.jff'), 'utf8');
    /**
     * The fixture still has its CRLF.
     *
     * Not a tautology: git normalizes line endings by default, and it silently stripped these
     * the first time the file was committed. With LF the parse below produces the same answer,
     * so every other assertion here would go on passing while no longer testing the CRLF path
     * at all. `.gitattributes` pins the file; this is what notices if that pin is ever lost.
     */
    expect(xml).toContain('flip on 0\r\nAnother line');

    const parsed = parseJflap(xml);

    expect(parsed.notes).toHaveLength(2);
    // Typed as two lines in JFLAP, saved as a CRLF, and one break here.
    expect(parsed.notes[0]).toMatchObject({
      text: 'flip on 0\nAnother line',
      xPos: 470,
      yPos: 250,
    });
    // The first line of this one carries a literal `&#13;` entity, which JFLAP renders as
    // "properlyand" with no break and no space.
    expect(parsed.notes[1]?.text.split('\n')).toEqual([
      'I am not sure this handles the empty string properlyand I ran out of time to check it before the deadline.',
      'New Line Example',
      'New Lines Example',
      'Another new line',
      'Yet another new line',
    ]);
  });

  it('reads a file that holds notes and no states', () => {
    const parsed = parseJflap(`
<structure>
  <type>fa</type>
  <automaton><note><text>Hi</text><x>0.0</x><y>0.0</y></note></automaton>
</structure>`);
    expect(parsed.states).toEqual([]);
    expect(parsed.notes).toEqual([{ text: 'Hi', xPos: 0, yPos: 0 }]);
  });

  describe('as cytoscape elements', () => {
    const parsed = () =>
      parseJflap(withNote('<note><text>look here</text><x>100</x><y>200</y></note>'));

    it('appears only when the saved positions are being used', () => {
      const drawn = toElements(parsed(), 'ε', true) as Array<{ classes?: string }>;
      expect(drawn.filter((e) => e.classes === 'note')).toHaveLength(1);

      // Auto-arranged: every state has moved, so a note left where the student put it would
      // annotate whatever it happened to land on.
      const arranged = toElements(parsed(), 'ε', false) as Array<{ classes?: string }>;
      expect(arranged.some((e) => e.classes === 'note')).toBe(false);
    });

    it('is scaled and offset from its top-left corner to its centre', () => {
      const note = (
        toElements(parsed(), 'ε', true) as Array<{
          classes?: string;
          position?: Point;
          data: { width: number; height: number };
        }>
      ).find((e) => e.classes === 'note')!;

      // JFLAP saves a note's top-left, because it is a Swing component positioned by
      // `setLocation`; cytoscape positions by centre. Half the box is the difference.
      expect(note.position?.x).toBeCloseTo(100 * POSITION_SCALE + note.data.width / 2, 5);
      expect(note.position?.y).toBeCloseTo(200 * POSITION_SCALE + note.data.height / 2, 5);
    });

    it('cannot be selected, dragged, or tapped', () => {
      const note = (
        toElements(parsed(), 'ε', true) as Array<{
          classes?: string;
          selectable?: boolean;
          grabbable?: boolean;
        }>
      ).find((e) => e.classes === 'note')!;
      expect(note.selectable).toBe(false);
      expect(note.grabbable).toBe(false);
    });

    /**
     * State ids come out of the file, so a student can name a state `note-0`. Cytoscape drops a
     * duplicate id without saying anything, which would silently lose an element.
     */
    it('does not collide with a state a student named like a note', () => {
      const xml = `
<structure>
  <type>fa</type>
  <automaton>
    <state id="jff-note-0" name="sneaky"><x>0</x><y>0</y><initial/></state>
    <note><text>mine</text><x>5</x><y>5</y></note>
  </automaton>
</structure>`;
      const ids = (toElements(parseJflap(xml), 'ε', true) as Array<{ data: { id: string } }>).map(
        (e) => e.data.id,
      );
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
