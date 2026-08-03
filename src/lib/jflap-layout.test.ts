import { describe, it, expect } from 'vitest';
import {
  bestLoopDirection,
  bestStartNodePosition,
  edgeLabelOffset,
  loopLabelOffset,
  EDGE_LABEL_GAP,
  LABEL_LINE_HEIGHT,
  LABEL_LOOP_GAP,
  LOOP_REACH,
  NODE_DIAMETER,
} from './jflap-layout';

const RADIUS = 1.5 * NODE_DIAMETER; // 87

describe('bestStartNodePosition', () => {
  it('places the stub due east (first direction) when nothing else is around', () => {
    const pos = bestStartNodePosition({ x: 10, y: 20 }, [], []);
    expect(pos.x).toBeCloseTo(10 + RADIUS);
    expect(pos.y).toBeCloseTo(20);
  });

  it('avoids a direction that would overlap another node', () => {
    // A node sitting exactly where the east stub would go makes east score ~1000,
    // so the least-cluttered pick is the opposite side (west).
    const pos = bestStartNodePosition({ x: 0, y: 0 }, [{ x: RADIUS, y: 0 }], []);
    expect(pos.x).toBeCloseTo(-RADIUS);
    expect(pos.y).toBeCloseTo(0);
  });

  it('steers away from a direction aligned with an incoming edge', () => {
    // An incoming edge coming from due east penalizes the east (0 rad) direction, so
    // the next direction (45°) wins when nothing else distinguishes them.
    const pos = bestStartNodePosition({ x: 0, y: 0 }, [], [0]);
    expect(pos.x).toBeCloseTo(RADIUS * Math.cos(Math.PI / 4));
    expect(pos.y).toBeCloseTo(RADIUS * Math.sin(Math.PI / 4));
  });

  it('always returns a point exactly one placement radius from the node', () => {
    const node = { x: 100, y: -40 };
    const pos = bestStartNodePosition(node, [{ x: 130, y: -40 }, { x: 60, y: 10 }], [1.2, 2.5]);
    const dist = Math.hypot(pos.x - node.x, pos.y - node.y);
    expect(dist).toBeCloseTo(RADIUS);
  });

  it('respects a custom node diameter', () => {
    const pos = bestStartNodePosition({ x: 0, y: 0 }, [], [], 100);
    expect(pos.x).toBeCloseTo(1.5 * 100); // east, radius = 150
    expect(pos.y).toBeCloseTo(0);
  });
});

describe('edgeLabelOffset', () => {
  const left = { x: 0, y: 0 };
  const right = { x: 200, y: 0 };

  it('pushes the label perpendicular to a straight edge', () => {
    // Midpoint on the line itself: nothing bows, so fall back to the perpendicular.
    const off = edgeLabelOffset(left, right, { x: 100, y: 0 });
    expect(off).toEqual({ x: 0, y: EDGE_LABEL_GAP });
  });

  it('separates the labels of two states joined in both directions', () => {
    // Cytoscape bows the pair apart, one curve above the line and one below. Each label
    // has to move further out, not back towards the other.
    const there = edgeLabelOffset(left, right, { x: 100, y: -20 });
    const back = edgeLabelOffset(right, left, { x: 100, y: 20 });

    expect(there.y).toBe(-EDGE_LABEL_GAP);
    expect(back.y).toBe(EDGE_LABEL_GAP);
    // Anchored on its own curve, each label ends up a clear span from the other; the old
    // perpendicular-to-direction rule put them 16px apart, overlapping at a 16px font.
    const gapBetweenLabels = 20 + back.y - (-20 + there.y);
    expect(gapBetweenLabels).toBe(64);
  });

  it('follows the bow of a diagonal edge', () => {
    const off = edgeLabelOffset({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 30, y: 70 });
    // Bow direction is up-left, at 135°, so the offset is the gap along that.
    expect(off.x).toBe(Math.round(-EDGE_LABEL_GAP * Math.SQRT1_2));
    expect(off.y).toBe(Math.round(EDGE_LABEL_GAP * Math.SQRT1_2));
  });

  it('takes a custom gap', () => {
    expect(edgeLabelOffset(left, right, { x: 100, y: -20 }, 30)).toEqual({ x: 0, y: -30 });
  });

  it('does not divide by a bow of zero length', () => {
    const off = edgeLabelOffset(left, right, { x: 100, y: 0.2 });
    expect(Number.isFinite(off.x)).toBe(true);
    expect(Number.isFinite(off.y)).toBe(true);
    expect(off).toEqual({ x: 0, y: EDGE_LABEL_GAP });
  });
});

describe('bestLoopDirection', () => {
  const node = { x: 0, y: 0 };

  it('keeps a loop pointing up when there is room above the state', () => {
    expect(bestLoopDirection(node, [], [])).toBe(0);
  });

  it('turns the loop away from a state sitting above this one', () => {
    // Canvas y grows downwards, so a state above is at negative y. Up is now blocked, and
    // the next-best of the eight candidates wins.
    const deg = bestLoopDirection(node, [{ x: 0, y: -LOOP_REACH }], []);
    expect(deg).not.toBe(0);
  });

  it('aims down when the state is at the bottom of a cluster above it', () => {
    // Two states up and to either side, as in the reported machine: the loop belongs
    // below, where nothing else is.
    const deg = bestLoopDirection(
      node,
      [
        { x: -95, y: -100 },
        { x: 95, y: -100 },
      ],
      [Math.atan2(-100, -95), Math.atan2(-100, 95)],
    );
    expect(deg).toBe(180);
  });

  it('returns a direction cytoscape can use, in degrees clockwise from up', () => {
    // Every candidate is one of the eight compass points.
    const deg = bestLoopDirection(node, [{ x: 0, y: -LOOP_REACH }], []);
    expect(deg % 45).toBe(0);
    expect(deg).toBeGreaterThanOrEqual(-180);
    expect(deg).toBeLessThanOrEqual(180);
  });
});

describe('loopLabelOffset', () => {
  const oneLine = LABEL_LINE_HEIGHT / 2 + LABEL_LOOP_GAP;

  it('lifts the label straight up above an upward loop', () => {
    expect(loopLabelOffset(0, 1)).toEqual({ x: 0, y: Math.round(-oneLine) });
  });

  it('drops the label below a downward loop', () => {
    expect(loopLabelOffset(180, 1)).toEqual({ x: 0, y: Math.round(oneLine) });
  });

  it('pushes the label out to the right of a rightward loop', () => {
    expect(loopLabelOffset(90, 1)).toEqual({ x: Math.round(oneLine), y: 0 });
  });

  it('clears a bundled label by its own height, not the loop as well', () => {
    // Four transitions on one loop: the label is four lines, and only has to clear half
    // of itself, because the far side of the loop is already where it is anchored.
    const off = loopLabelOffset(0, 4);
    expect(off.y).toBe(-Math.round((4 * LABEL_LINE_HEIGHT) / 2 + LABEL_LOOP_GAP));
  });

  it('treats a label with no lines as one line', () => {
    expect(loopLabelOffset(0, 0)).toEqual(loopLabelOffset(0, 1));
  });
});
