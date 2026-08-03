import { describe, it, expect } from 'vitest';
import {
  bestLoopDirection,
  edgeLabelOffset,
  loopLabelOffset,
  startMarkerPosition,
  EDGE_LABEL_GAP,
  LABEL_LINE_HEIGHT,
  LABEL_LOOP_GAP,
  LOOP_REACH,
  NODE_DIAMETER,
  START_MARKER_WIDTH,
} from './jflap-layout';

describe('startMarkerPosition', () => {
  it('puts the marker due west of the state, as JFLAP does', () => {
    const pos = startMarkerPosition({ x: 100, y: 40 });
    expect(pos.x).toBeLessThan(100);
    expect(pos.y).toBe(40);
  });

  it('leaves the marker just touching the state, with no gap and no overlap', () => {
    const state = { x: 100, y: 40 };
    const pos = startMarkerPosition(state);
    // The marker's point is its right edge; the state's rim is one radius out.
    const markerPoint = pos.x + START_MARKER_WIDTH / 2;
    expect(markerPoint).toBeCloseTo(state.x - NODE_DIAMETER / 2);
  });

  it('respects a custom node diameter', () => {
    const pos = startMarkerPosition({ x: 0, y: 0 }, 100);
    expect(pos.x).toBeCloseTo(-50 - START_MARKER_WIDTH / 2);
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

  it('stands off perpendicular to a diagonal edge, on the side it bows towards', () => {
    const off = edgeLabelOffset({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 30, y: 70 });
    expect(off.x).toBe(Math.round(-EDGE_LABEL_GAP * Math.SQRT1_2));
    expect(off.y).toBe(Math.round(EDGE_LABEL_GAP * Math.SQRT1_2));
  });

  it('keeps a straight edge label off the line when the midpoint is a pixel or two out', () => {
    // Cytoscape reports the midpoint of this straight edge as (96,159) where the true one
    // is (98,160). Reading a direction out of that 2px difference pushed the label along
    // the edge instead of away from it, and it came out drawn across its own line.
    const source = { x: 50, y: 110 };
    const target = { x: 145, y: 210 };
    const off = edgeLabelOffset(source, target, { x: 96, y: 159 });

    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const length = Math.hypot(dx, dy);
    // Distance from the offset label to the line it belongs to: the whole gap, not a
    // fraction of it.
    const fromLine = Math.abs(off.x * -dy + off.y * dx) / length;
    expect(fromLine).toBeCloseTo(EDGE_LABEL_GAP, 0);
  });

  it('takes a custom gap', () => {
    expect(edgeLabelOffset(left, right, { x: 100, y: -20 }, 30)).toEqual({ x: 0, y: -30 });
  });

  it('handles a midpoint that coincides with the endpoints', () => {
    const off = edgeLabelOffset(left, left, { x: 0, y: 0 });
    expect(Number.isFinite(off.x)).toBe(true);
    expect(Number.isFinite(off.y)).toBe(true);
    expect(off).toEqual({ x: 0, y: EDGE_LABEL_GAP });
  });
});

describe('bestLoopDirection', () => {
  const node = { x: 0, y: 0 };
  // Canvas y grows downwards, so straight above the state is negative y, and this is
  // where the loop's label lands when the loop points up.
  const aboveTheState = { x: 0, y: -(LOOP_REACH + 19) };

  it('points the loop up, where JFLAP draws it, when there is room', () => {
    expect(bestLoopDirection(node, [], [])).toBe(0);
  });

  it('stays up when the neighbours are on that side but not in the way', () => {
    // Two states up and to either side, as in the reported DFA. They are nowhere near
    // where the loop label goes, so the picture keeps matching JFLAP. A rule that merely
    // preferred open space would have swung the loop downwards here.
    expect(
      bestLoopDirection(
        node,
        [
          { x: -95, y: -100 },
          { x: 95, y: -100 },
        ],
        [Math.atan2(-100, -95), Math.atan2(-100, 95)],
      ),
    ).toBe(0);
  });

  it('turns aside when something already occupies where the label would go', () => {
    const deg = bestLoopDirection(node, [aboveTheState], []);
    expect(deg).not.toBe(0);
  });

  it('turns aside for a transition label, not just for a state', () => {
    // On a tight machine it is another edge's label the loop collides with, which is why
    // the caller passes label anchors in alongside the states.
    expect(bestLoopDirection(node, [{ x: 4, y: -74 }], [])).not.toBe(0);
  });

  it('picks a direction that is actually clear of the obstacle', () => {
    const deg = bestLoopDirection(node, [aboveTheState], []);
    const angle = ((deg - 90) * Math.PI) / 180;
    const label = {
      x: Math.cos(angle) * (LOOP_REACH + 19),
      y: Math.sin(angle) * (LOOP_REACH + 19),
    };
    expect(Math.hypot(label.x - aboveTheState.x, label.y - aboveTheState.y)).toBeGreaterThan(
      NODE_DIAMETER / 2,
    );
  });

  it('returns one of the eight compass points, in degrees clockwise from up', () => {
    const deg = bestLoopDirection(node, [aboveTheState], []);
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
