/**
 * The little bit of trigonometry the decorative automata share.
 *
 * Five diagrams draw the same two things: a straight edge from one state's rim to another's,
 * and a loop from a state back to itself. Writing those coordinates out by hand five times is
 * how the drawings quietly stop matching, and how an arrowhead ends up inside a circle. This
 * is a helper, not a layout engine: nothing here decides where a state goes.
 */

export type State = { x: number; y: number; r: number };

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * The visible part of the line between two states: from the first circle's rim to just
 * outside the second's, never centre to centre.
 *
 * `endInset` is the room the arrowhead needs. The marker's tip sits two user units past the
 * end of the line it is on, so three units of inset puts the point on the boundary rather
 * than inside the state.
 */
export function edgeBetween(from: State, to: State, endInset = 3) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const x1 = from.x + ux * from.r;
  const y1 = from.y + uy * from.r;
  const x2 = to.x - ux * (to.r + endInset);
  const y2 = to.y - uy * (to.r + endInset);
  return {
    /** Spread straight onto a <line>; nothing else in here belongs on the element. */
    line: { x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2) },
    /**
     * A point `offset` units off the middle of the edge, at right angles to it. The sign
     * picks the side, so a label is always placed against its own line rather than at a
     * coordinate that happens to look right today.
     */
    labelAt: (offset: number) => ({
      x: round((x1 + x2) / 2 - uy * offset),
      y: round((y1 + y2) / 2 + ux * offset),
    }),
  };
}

/**
 * A pair of straight edges running both ways between the same two states.
 *
 * Two antiparallel lines between one pair would land exactly on top of each other, so each is
 * pushed `offset` units to its own side. They stay straight, which is the rule for an edge
 * between two different states; only a state pointing at itself gets a curve.
 */
export function parallelEdge(from: State, to: State, offset: number, endInset = 3) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  // Where a line this far off centre actually crosses each circle, rather than where the
  // centre line does: a chord, not a radius.
  const chord = (r: number) => Math.sqrt(Math.max(0, r * r - offset * offset));
  const px = -uy * offset;
  const py = ux * offset;
  const x1 = from.x + ux * chord(from.r) + px;
  const y1 = from.y + uy * chord(from.r) + py;
  const x2 = to.x - ux * (chord(to.r) + endInset) + px;
  const y2 = to.y - uy * (chord(to.r) + endInset) + py;
  return {
    line: { x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2) },
    labelAt: (labelOffset: number) => ({
      x: round((x1 + x2) / 2 - uy * labelOffset),
      y: round((y1 + y2) / 2 + ux * labelOffset),
    }),
  };
}

/**
 * A loop from a state back to itself, leaving the top left and returning to the top right.
 *
 * `rise` is how far the control points are lifted; the curve's apex ends up three quarters of
 * that above the rim, which is where the label goes.
 */
export function selfLoop(state: State, rise = 54) {
  const d = state.r * 0.707;
  const ex = state.x - d;
  const ey = state.y - d;
  const nx = state.x + d;
  const spread = state.r * 1.35;
  const apex = ey - rise * 0.75;
  return {
    d: `M${round(ex)} ${round(ey)}C${round(state.x - spread)} ${round(ey - rise)} ${round(state.x + spread)} ${round(ey - rise)} ${round(nx)} ${round(ey)}`,
    label: { x: state.x, y: round(apex - 14) },
  };
}
