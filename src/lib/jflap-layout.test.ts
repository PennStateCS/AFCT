import { describe, it, expect } from 'vitest';
import {
  bestLoopDirection,
  bestStartMarkerDirection,
  edgeLabelOffset,
  loopLabelOffset,
  startMarkerPolygon,
  startMarkerPosition,
  EDGE_LABEL_GAP,
  LABEL_LINE_HEIGHT,
  LABEL_LOOP_GAP,
  LOOP_REACH,
  NODE_DIAMETER,
  START_MARKER_SIZE,
} from './jflap-layout';

describe('the initial-state marker', () => {
  const state = { x: 100, y: 40 };
  const WEST = Math.PI;

  it('sits due west of the state by default, as JFLAP draws it', () => {
    const pos = startMarkerPosition(state);
    expect(pos.x).toBeLessThan(state.x);
    expect(pos.y).toBeCloseTo(state.y);
  });

  it('puts the triangle point on the state rim, with no gap and no overlap', () => {
    for (const angle of [WEST, 0, Math.PI / 2, -Math.PI / 4]) {
      const pos = startMarkerPosition(state, angle);
      // The point is half a box out from the box centre, facing back at the state.
      const point = {
        x: pos.x - (Math.cos(angle) * START_MARKER_SIZE) / 2,
        y: pos.y - (Math.sin(angle) * START_MARKER_SIZE) / 2,
      };
      expect(Math.hypot(point.x - state.x, point.y - state.y)).toBeCloseTo(NODE_DIAMETER / 2);
    }
  });

  it('respects a custom node diameter', () => {
    const pos = startMarkerPosition({ x: 0, y: 0 }, WEST, 100);
    expect(pos.x).toBeCloseTo(-100);
  });

  it('stays on the left when nothing is in the way', () => {
    expect(bestStartMarkerDirection(state, [], [])).toBeCloseTo(WEST);
  });

  it('moves off the left when a transition runs out that side', () => {
    // This is the automatic layout's problem: nothing there keeps the initial state's
    // left clear, and the marker was drawn across the transitions leaving it.
    const angle = bestStartMarkerDirection(state, [], [WEST]);
    expect(angle).not.toBeCloseTo(WEST);
  });

  it('moves off the left when another state is sitting there', () => {
    const blocked = { x: state.x - NODE_DIAMETER, y: state.y };
    expect(bestStartMarkerDirection(state, [blocked], [])).not.toBeCloseTo(WEST);
  });

  it('points the triangle east when it sits on the left of the state', () => {
    // Three corners in cytoscape's -1..1 box: top left, the point, bottom left.
    expect(startMarkerPolygon(WEST)).toBe('0 -1, 1 0, 0 1');
  });

  it('turns the triangle to keep pointing back at the state', () => {
    // Sitting due east, the point must face west instead.
    const points = startMarkerPolygon(0)
      .split(', ')
      .map((p) => p.split(' ').map(Number) as [number, number]);
    const point = points.find(([x, y]) => Math.abs(y) < 0.001 && Math.abs(x) > 0.5);
    expect(point?.[0]).toBeCloseTo(-1);
  });

  it('keeps the triangle the same shape whichever way it faces', () => {
    // The box is square, so a turned triangle must not stretch: every corner stays the
    // same distance from the centre.
    for (const angle of [WEST, 0, Math.PI / 2, -Math.PI / 4, Math.PI / 4]) {
      const radii = startMarkerPolygon(angle)
        .split(', ')
        .map((p) => {
          const [x, y] = p.split(' ').map(Number) as [number, number];
          return Math.hypot(x, y);
        });
      for (const r of radii) expect(r).toBeCloseTo(1);
    }
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

  it('lines up the two labels of a bidirectional pair', () => {
    // The midpoints here are what cytoscape actually reports for two level states 200
    // apart: each is ~0.9px towards its own source, because the drawn curve is shortened
    // at the target end for the arrowhead. Pointing opposite ways, the pair drifted 1.7px
    // apart and visibly failed to line up.
    const q0 = { x: 100, y: 150 };
    const q1 = { x: 300, y: 150 };
    const there = edgeLabelOffset(q0, q1, { x: 199.14, y: 136.89 });
    const back = edgeLabelOffset(q1, q0, { x: 200.86, y: 163.11 });

    expect(199.14 + there.x).toBeCloseTo(200.86 + back.x, 0);
    // Still one above the pair and one below, each on its own arc.
    expect(136.89 + there.y).toBeLessThan(150);
    expect(163.11 + back.y).toBeGreaterThan(150);
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
