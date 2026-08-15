import { describe, expect, it } from 'vitest';
import { extractProvenanceFeatures, PROVENANCE_FEATURE_VERSION } from './provenance';

/**
 * A four-state automaton, and the edits somebody makes to a file they were given. Each
 * option is one of the cases the third check exists for.
 */
function fa(
  options: {
    /** Move the whole drawing, which is what dragging the canvas does. */
    dx?: number;
    dy?: number;
    /** Scale it, which is what resizing does. */
    scale?: number;
    /** Rename the visible states. JFLAP keeps its own ids underneath. */
    names?: boolean;
    /** Drop one transition. */
    dropTransition?: boolean;
    /** Add a state nobody needed. */
    extraState?: boolean;
    /** Move one state out of place, leaving the others. */
    nudge?: number;
    /** Hand-adjust the curve on one transition. */
    control?: { x: number; y: number } | null;
    /** Different underlying ids, as a fresh drawing would have. */
    idOffset?: number;
  } = {},
) {
  const dx = options.dx ?? 0;
  const dy = options.dy ?? 0;
  const scale = options.scale ?? 1;
  const offset = options.idOffset ?? 0;
  const id = (n: number) => n + offset;
  const name = (n: number) => (options.names ? `s${n}` : `q${n}`);
  const at = (x: number, y: number, index: number) => {
    const nudge = options.nudge && index === 2 ? options.nudge : 0;
    return `<x>${x * scale + dx + nudge}</x><y>${y * scale + dy}</y>`;
  };

  const control = options.control
    ? `<controlx>${options.control.x}</controlx><controly>${options.control.y}</controly>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?><structure>
  <type>fa</type>
  <automaton>
    <state id="${id(0)}" name="${name(0)}">${at(90, 210, 0)}<initial/></state>
    <state id="${id(1)}" name="${name(1)}">${at(260, 110, 1)}</state>
    <state id="${id(2)}" name="${name(2)}">${at(430, 210, 2)}</state>
    <state id="${id(3)}" name="${name(3)}">${at(600, 110, 3)}<final/></state>
    ${options.extraState ? `<state id="${id(9)}" name="${name(9)}">${at(300, 400, 9)}</state>` : ''}
    <transition><from>${id(0)}</from><to>${id(1)}</to><read>1</read>${control}</transition>
    <transition><from>${id(1)}</from><to>${id(2)}</to><read>1</read></transition>
    ${options.dropTransition ? '' : `<transition><from>${id(2)}</from><to>${id(3)}</to><read>1</read></transition>`}
    <transition><from>${id(0)}</from><to>${id(0)}</to><read>0</read></transition>
    <transition><from>${id(3)}</from><to>${id(3)}</to><read>0</read></transition>
    ${options.extraState ? `<transition><from>${id(2)}</from><to>${id(9)}</to><read>0</read></transition>` : ''}
  </automaton>
</structure>`;
}

const featuresOf = (xml: string) => extractProvenanceFeatures(xml)?.features ?? [];
const sharedWith = (a: string, b: string) => {
  const other = new Set(featuresOf(b));
  return featuresOf(a).filter((feature) => other.has(feature));
};
const withPrefix = (features: string[], prefix: string) =>
  features.filter((feature) => feature.startsWith(`${prefix}:`));

describe('extractProvenanceFeatures', () => {
  it('describes a machine in pieces, and says which rules produced them', () => {
    const features = extractProvenanceFeatures(fa());

    expect(features?.version).toBe(PROVENANCE_FEATURE_VERSION);
    expect(features?.machineType).toBe('fa');
    expect(features?.stateCount).toBe(4);
    expect(features?.transitionCount).toBe(5);
    expect(withPrefix(features?.features ?? [], 'f').length).toBeGreaterThan(0);
  });

  it('has nothing to say about a file with no structure it can read', () => {
    expect(extractProvenanceFeatures('(a|b)*abb')).toBeNull();
    expect(extractProvenanceFeatures('<structure><type>re</type><expression>a*</expression></structure>')).toBeNull();
  });

  it('keeps the whole description small', () => {
    // A description of the artifact, not a second copy of it.
    expect(JSON.stringify(extractProvenanceFeatures(fa())).length).toBeLessThan(2_000);
  });

  it('survives the whole drawing being moved or resized', () => {
    const whole = withPrefix(featuresOf(fa()), 'g').length;
    expect(whole).toBeGreaterThan(0);

    for (const edited of [fa({ dx: 400, dy: 250 }), fa({ scale: 1.5 })]) {
      // Every step between states is unchanged: the layout is described relative to itself.
      expect(withPrefix(sharedWith(fa(), edited), 'g')).toHaveLength(whole);
    }
  });

  it('survives the states being renamed, through the ids underneath', () => {
    const shared = sharedWith(fa(), fa({ names: true }));

    expect(withPrefix(shared, 't').length).toBeGreaterThanOrEqual(4);
    // The local structure does not depend on names either.
    expect(withPrefix(shared, 'f').length).toBeGreaterThanOrEqual(4);
  });

  it('keeps most pieces when one transition is removed', () => {
    const shared = withPrefix(sharedWith(fa(), fa({ dropTransition: true })), 'f');
    const whole = withPrefix(featuresOf(fa()), 'f');

    // Half of the description survives an edit to a four-state machine, which is the point:
    // the two hashes keep none of it.
    expect(shared.length).toBeGreaterThanOrEqual(whole.length / 2);
    expect(shared.length).toBeLessThan(whole.length);
  });

  it('keeps more of the coarse description than the fine one when a label changes', () => {
    const relabelled = fa().replace('<read>1</read>', '<read>x</read>');
    const shared = sharedWith(fa(), relabelled);

    // The coarse pieces do not mention labels, so they hold where the fine ones do not.
    const coarse = shared.filter((f) => f.startsWith('f:sd:') || f.startsWith('f:el:')).length;
    const fine = shared.filter((f) => f.startsWith('f:s:') || f.startsWith('f:e:')).length;
    expect(coarse).toBeGreaterThan(fine);
  });

  it('keeps most pieces when a state is added', () => {
    const shared = withPrefix(sharedWith(fa(), fa({ extraState: true })), 'f');
    const whole = withPrefix(featuresOf(fa()), 'f');

    expect(shared.length).toBeGreaterThan(whole.length / 2);
  });

  it('keeps the placement of the states that did not move', () => {
    const shared = withPrefix(sharedWith(fa(), fa({ nudge: 120 })), 'g');
    const whole = withPrefix(featuresOf(fa()), 'g');

    // Some of the layout survives one state being dragged out of place, and some does not.
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.length).toBeLessThan(whole.length);
  });

  it('records a hand-adjusted curve against the states it joins', () => {
    const curved = fa({ control: { x: 175, y: 20 } });
    const curvedElsewhere = fa({ dx: 500, control: { x: 675, y: 20 } });

    // The same curve on a machine that has been dragged across the canvas is the same curve.
    expect(withPrefix(sharedWith(curved, curvedElsewhere), 'c').length).toBe(1);
    // And a machine with no hand-adjusted curve shares none of it.
    expect(withPrefix(sharedWith(curved, fa()), 'c')).toHaveLength(0);
  });

  it('does not pretend two independently built machines share identifiers', () => {
    // The same machine drawn from scratch: JFLAP hands out different ids.
    const shared = sharedWith(fa(), fa({ idOffset: 10 }));

    expect(withPrefix(shared, 't')).toHaveLength(0);
    // Its structure still matches, which is what the shape hash is for.
    expect(withPrefix(shared, 'f').length).toBeGreaterThan(0);
  });

  it('records a state nothing can reach', () => {
    const stranded = fa().replace(
      '</automaton>',
      '<state id="7" name="q7"><x>800</x><y>400</y></state></automaton>',
    );

    const features = featuresOf(stranded);
    expect(features.some((feature) => feature.startsWith('u:unreachable:'))).toBe(true);
    // The machine it came from has no such state.
    expect(featuresOf(fa()).some((feature) => feature.startsWith('u:unreachable:'))).toBe(false);
  });

  it('records a dead end, and keys it on what the state looks like rather than its name', () => {
    // A state that is reachable but from which nothing accepts.
    const trap = fa().replace(
      '</automaton>',
      '<state id="8" name="trap"><x>430</x><y>400</y></state>' +
        '<transition><from>1</from><to>8</to><read>0</read></transition></automaton>',
    );
    const sameTrapRenamed = trap.replace('name="trap"', 'name="sink"');

    const dead = featuresOf(trap).filter((feature) => feature.startsWith('u:dead:'));
    expect(dead.length).toBeGreaterThan(0);
    // Renaming it changes nothing, which is the point of keying on the shape of the state.
    expect(featuresOf(sameTrapRenamed)).toEqual(expect.arrayContaining(dead));
  });

  it('records the same transition being entered twice', () => {
    const twice = fa().replace(
      '</automaton>',
      '<transition><from>1</from><to>2</to><read>1</read></transition></automaton>',
    );

    expect(featuresOf(twice).some((feature) => feature.startsWith('u:repeated:'))).toBe(true);
    expect(featuresOf(fa()).some((feature) => feature.startsWith('u:repeated:'))).toBe(false);
  });

  it('takes what was written on the drawing exactly as written', () => {
    const annotated = fa()
      .replace('<initial/>', '<initial/><label>start here!!</label>')
      .replace('</automaton>', '</automaton><note><text>remember the epsilon</text><x>10</x><y>10</y></note>');

    const features = featuresOf(annotated);
    expect(features).toContain('l:start here!!');
    expect(features).toContain('n:remember the epsilon');
    // Nothing is invented for a drawing with nothing written on it.
    expect(featuresOf(fa()).some((f) => f.startsWith('l:') || f.startsWith('n:'))).toBe(false);
  });

  it('does not decide that two different notes are close enough', () => {
    const noteOf = (body: string) =>
      featuresOf(fa().replace('</automaton>', `</automaton><note><text>${body}</text></note>`));

    // Exact only: judging two wordings "similar enough" is the kind of call this must not make.
    expect(noteOf('remember the epsilon')).not.toEqual(
      expect.arrayContaining(noteOf('Remember the epsilon')),
    );
  });

  it('keeps a Turing machine\'s building blocks apart from the top-level machine', () => {
    const withBlocks = `<structure><type>turing</type><automaton>
      <state id="0" name="q0"><x>10</x><y>10</y><initial/></state>
      <state id="1" name="q1"><x>90</x><y>10</y><final/></state>
      <transition><from>0</from><to>1</to><read>a</read><write>b</write><move>R</move></transition>
      <block id="2" name="shift-right"><x>50</x><y>90</y><automaton>
        <state id="0" name="b0"><x>5</x><y>5</y><initial/></state>
        <state id="1" name="b1"><x>60</x><y>5</y><final/></state>
        <transition><from>0</from><to>1</to><read>a</read><write>a</write><move>R</move></transition>
      </automaton></block>
    </automaton></structure>`;

    const features = featuresOf(withBlocks);
    expect(features).toContain('b:shift-right');
    expect(features).toContain('b:shift-right:2,1');
    // The block's own 0>1 is recorded against the block, so it cannot be mistaken for the
    // top-level 0>1 and inflate a match between two unrelated machines.
    expect(features).toContain('b:shift-right:0>1');
  });

  it('keeps a grammar as written, which the shape hash deliberately forgets', () => {
    const grammar = (order: 'ab' | 'ba', variable = 'S') =>
      `<structure><type>grammar</type>${
        order === 'ab'
          ? `<production><left>${variable}</left><right>a${variable}b</right></production><production><left>${variable}</left><right>ab</right></production>`
          : `<production><left>${variable}</left><right>ab</right></production><production><left>${variable}</left><right>a${variable}b</right></production>`
      }</structure>`;

    // Written in the same order, with the same variable: a pairing feature they share.
    expect(sharedWith(grammar('ab'), grammar('ab')).some((f) => f.startsWith('f:pp:'))).toBe(true);
    // A different order shares the productions but not the ordering.
    expect(sharedWith(grammar('ab'), grammar('ba')).some((f) => f.startsWith('f:pp:'))).toBe(false);
    // A different helper variable shares neither.
    expect(sharedWith(grammar('ab'), grammar('ab', 'T'))).toHaveLength(0);
  });
});
