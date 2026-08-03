// src/lib/jflap-layout.ts
//
// Pure geometry for the JFLAP viewer: placing a finite-automaton "start" stub next to its
// initial state, aiming a self-loop into free space, and offsetting a transition label
// clear of whatever it belongs to. Extracted from JffViewerDialog, where the
// clutter-scoring loop was duplicated (initial layout + drag reposition), so it can live
// and be tested on its own.
//
// Angles in this file are screen angles in radians unless a name says otherwise: measured
// from due east, and turning clockwise, because canvas y grows downwards.

export type Point = { x: number; y: number };

/** Diameter of a state node in the JFLAP viewer; sets the overlap threshold. */
export const NODE_DIAMETER = 58;

/** How far a transition label sits off its edge, in pixels. */
export const EDGE_LABEL_GAP = 12;

/** Line box of a transition label at the 16px edge font, and its clearance from a loop. */
export const LABEL_LINE_HEIGHT = 19;
export const LABEL_LOOP_GAP = 10;

/**
 * How far a self-loop's far side sits from the centre of its state. Measured off the
 * rendered graph at the loop styling the viewer uses (a 58px state, a 48px control-point
 * step); cytoscape works it out from several style properties at once, so there is no
 * single one to read it from.
 */
export const LOOP_REACH = 61;

/** Screen angle of each of the 8 compass directions, starting due east. */
const COMPASS = Array.from({ length: 8 }, (_, i) => i * (Math.PI / 4));

/** The same 8 directions, but starting straight up and turning clockwise. */
const COMPASS_FROM_NORTH = Array.from({ length: 8 }, (_, i) => -Math.PI / 2 + i * (Math.PI / 4));

/**
 * Of the given candidate directions, the one with the least around it: nothing may be
 * drawn on top of a state, and lining up with an edge already leaving the state is nearly
 * as bad. Ties go to the earliest candidate, so callers order the list by preference.
 *
 * `radius` is how far out the thing being placed will sit, and `incidentAngles` are the
 * screen angles of the edges already at this state.
 */
function leastClutteredAngle(
  candidates: number[],
  nodePos: Point,
  otherNodePositions: Point[],
  incidentAngles: number[],
  radius: number,
  clearance: number,
): number {
  const scores = candidates.map((angle) => {
    const testX = nodePos.x + Math.cos(angle) * radius;
    const testY = nodePos.y + Math.sin(angle) * radius;

    let score = 0;
    for (const pos of otherNodePositions) {
      const dx = testX - pos.x;
      const dy = testY - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < clearance)
        score += 1000; // heavy penalty for overlap
      else score += 1 / dist;
    }

    for (const edgeAngle of incidentAngles) {
      let diff = Math.abs(angle - edgeAngle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff < Math.PI / 6) score += 10; // within 30° of an edge already there
    }
    return score;
  });

  let bestIdx = 0;
  let bestScore = scores[0] ?? Infinity;
  for (let i = 1; i < scores.length; ++i) {
    const s = scores[i];
    if (s !== undefined && s < bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }
  return candidates[bestIdx] ?? 0;
}

/**
 * Choose where to place the start-arrow stub for an initial node: the least-cluttered of
 * the 8 compass directions, at 1.5× the node diameter. Returns the chosen point.
 */
export function bestStartNodePosition(
  nodePos: Point,
  otherNodePositions: Point[],
  incomingAngles: number[],
  nodeDiameter: number = NODE_DIAMETER,
): Point {
  const radius = 1.5 * nodeDiameter;
  const angle = leastClutteredAngle(
    COMPASS,
    nodePos,
    otherNodePositions,
    incomingAngles,
    radius,
    nodeDiameter * 1.1,
  );
  return {
    x: nodePos.x + Math.cos(angle) * radius,
    y: nodePos.y + Math.sin(angle) * radius,
  };
}

/**
 * Which way a state's self-loop should arc, in the degrees cytoscape's `loop-direction`
 * wants: zero is straight up and the angle turns clockwise.
 *
 * Every loop used to arc straight up, which is where JFLAP puts them, but JFLAP draws a
 * much smaller loop. At the size this viewer draws them a loop and its label reach a good
 * way past the state, so on a state that has anything above it, the label landed on the
 * transitions up there. Aiming the loop at the emptiest side keeps it out of the way, and
 * `up` is still the first candidate, so a state with room above it is unaffected.
 */
export function bestLoopDirection(
  nodePos: Point,
  otherNodePositions: Point[],
  incidentAngles: number[],
  reach: number = LOOP_REACH,
): number {
  const angle = leastClutteredAngle(
    COMPASS_FROM_NORTH,
    nodePos,
    otherNodePositions,
    incidentAngles,
    reach,
    NODE_DIAMETER * 1.1,
  );
  // Screen angle (east, clockwise) back to cytoscape's loop angle (north, clockwise).
  const degrees = Math.round((Math.atan2(Math.cos(angle), -Math.sin(angle)) * 180) / Math.PI);
  return degrees;
}

/**
 * How far to shift a self-loop's label off the point cytoscape anchors it to, which is
 * the far side of the loop. Pushes it further out along the loop's own direction, by
 * enough to clear its own height: every transition between the same pair of states is
 * bundled into one edge whose label is those transitions on separate lines, so a busy
 * state's loop can carry a dozen.
 *
 * `loopDirectionDegrees` is what `bestLoopDirection` returned. The loop's far side is
 * already the anchor, so this must not also count the loop's own reach: doing that parked
 * a one-line label a long way off in space.
 */
export function loopLabelOffset(
  loopDirectionDegrees: number,
  lineCount: number,
  lineHeight: number = LABEL_LINE_HEIGHT,
  gap: number = LABEL_LOOP_GAP,
): Point {
  const angle = ((loopDirectionDegrees - 90) * Math.PI) / 180; // back to a screen angle
  const push = (Math.max(1, lineCount) * lineHeight) / 2 + gap;
  return {
    x: Math.round(Math.cos(angle) * push),
    y: Math.round(Math.sin(angle) * push),
  };
}

/**
 * How far to shift a transition label off the point cytoscape anchors it to, which is the
 * midpoint of the drawn curve.
 *
 * The offset follows the direction the curve already bows: from the straight line between
 * the two states out to that curve's own midpoint. It used to be a flat 90° turn from the
 * source→target direction, which reads fine for a lone edge but breaks on the common case
 * of two states with a transition each way. Cytoscape bows those two curves apart, and
 * rotating from each edge's own direction then sends both labels into the gap between the
 * curves, one on top of the other. Following the bow instead pushes them apart, the way
 * JFLAP puts one label above the pair and one below.
 *
 * A straight edge has no bow to follow, so it falls back to the perpendicular.
 */
export function edgeLabelOffset(
  source: Point,
  target: Point,
  midpoint: Point,
  gap: number = EDGE_LABEL_GAP,
): Point {
  let ux = midpoint.x - (source.x + target.x) / 2;
  let uy = midpoint.y - (source.y + target.y) / 2;
  const bow = Math.hypot(ux, uy);

  // Below a pixel the "bow" is rounding noise, and normalizing it would point the label
  // in an arbitrary direction.
  if (!Number.isFinite(bow) || bow < 1) {
    const angle = Math.atan2(target.y - source.y, target.x - source.x) + Math.PI / 2;
    ux = Math.cos(angle);
    uy = Math.sin(angle);
  } else {
    ux /= bow;
    uy /= bow;
  }

  return { x: Math.round(ux * gap), y: Math.round(uy * gap) };
}
