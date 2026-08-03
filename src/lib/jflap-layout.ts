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

/**
 * Smallest curve bow that counts as one rather than as rounding. Cytoscape reports the
 * midpoint of a straight edge up to about two pixels off the true midpoint; the bow it
 * puts on a pair of opposed edges is an order of magnitude larger.
 */
const MIN_BOW = 4;

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

/**
 * How much room a self-loop's label needs around it before its direction counts as taken.
 * Roughly a state's radius plus a label's own half-height, so a loop is turned aside by
 * something genuinely in its way and not by a neighbour merely being on that side.
 */
const LOOP_LABEL_CLEARANCE = NODE_DIAMETER / 2 + LABEL_LINE_HEIGHT / 2;

/** Screen angle of each of the 8 compass directions, starting due east. */
const COMPASS = Array.from({ length: 8 }, (_, i) => i * (Math.PI / 4));

/** The same 8 directions, but starting straight up and turning clockwise. */
const COMPASS_FROM_NORTH = Array.from({ length: 8 }, (_, i) => -Math.PI / 2 + i * (Math.PI / 4));

/**
 * Of the given candidate directions, the one with the least around it. Lining up with an
 * edge already leaving the state is penalized as well, since whatever is placed there
 * would sit along that edge. Ties go to the earliest candidate, so callers order the list
 * by preference.
 *
 * `radius` is how far out the thing being placed will sit, `obstacles` are the points it
 * has to stay clear of, and `incidentAngles` are the screen angles of the edges already
 * at this state. `penalty` scores one obstacle from its distance, which is what separates
 * the two callers: see each of them for why.
 */
function leastClutteredAngle(
  candidates: number[],
  nodePos: Point,
  obstacles: Point[],
  incidentAngles: number[],
  radius: number,
  penalty: (distance: number) => number,
): number {
  const scores = candidates.map((angle) => {
    const testX = nodePos.x + Math.cos(angle) * radius;
    const testY = nodePos.y + Math.sin(angle) * radius;

    let score = 0;
    for (const pos of obstacles) {
      const dx = testX - pos.x;
      const dy = testY - pos.y;
      score += penalty(Math.sqrt(dx * dx + dy * dy));
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
    // The stub has no natural home, so past the overlap penalty it also drifts towards
    // whichever side is emptiest.
    (dist) => (dist < nodeDiameter * 1.1 ? 1000 : 1 / dist),
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
 * Straight up is where JFLAP puts every loop, and where this returns whenever there is
 * room, because matching the desktop tool is worth more than a tidier picture. But JFLAP
 * draws a far smaller loop. At the size this viewer draws them, a loop and its label
 * reach a good way past the state, so on a crowded state the label landed on top of the
 * transitions above it. Hence: up unless up is taken, and only then the next way round.
 *
 * That is why this scores obstacles by a flat threshold and not by distance. Anything
 * that merely prefers open space walks loops away from `up` on machines that read fine
 * with them there, and the picture stops looking like the one the student drew.
 *
 * `obstacles` should be the other states plus the anchor of every transition label
 * already placed, because on a tight machine it is a label, not a state, that the loop
 * collides with.
 */
export function bestLoopDirection(
  nodePos: Point,
  obstacles: Point[],
  incidentAngles: number[],
  reach: number = LOOP_REACH,
): number {
  const angle = leastClutteredAngle(
    COMPASS_FROM_NORTH,
    nodePos,
    obstacles,
    incidentAngles,
    // Test where the loop's LABEL will sit, not the loop: that is the part that reaches
    // furthest and the part that has to stay readable.
    reach + LABEL_LINE_HEIGHT,
    (dist) => (dist < LOOP_LABEL_CLEARANCE ? 1000 : 0),
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
 * The label always moves straight out from the edge, which is the direction that clears
 * the line for the least distance travelled. Only the SIDE comes from the curve: it goes
 * to whichever side that curve already bows towards.
 *
 * The side is the part that matters, because of two states with a transition each way.
 * Cytoscape bows those two curves apart, and the rule this replaced turned 90° from each
 * edge's own source→target direction, which sent both labels into the gap between the
 * curves, one on top of the other. Picking the side by the bow separates them, the way
 * JFLAP puts one label above the pair and one below.
 */
export function edgeLabelOffset(
  source: Point,
  target: Point,
  midpoint: Point,
  gap: number = EDGE_LABEL_GAP,
): Point {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  // A self-loop or a zero-length edge has no direction to stand off from.
  if (!length || !Number.isFinite(length)) return { x: 0, y: gap };

  const perpX = -dy / length;
  const perpY = dx / length;

  // How far the curve bows, and to which side. Cytoscape's midpoint for a straight edge
  // lands a pixel or two off the true midpoint, and reading a direction out of that
  // rounding noise is what used to leave a label sitting across its own edge, so only a
  // bow clearly bigger than the noise gets a vote. Below it, either side is as good, and
  // keeping the sign positive leaves a lone edge's label where it has always been.
  const bow =
    (midpoint.x - (source.x + target.x) / 2) * perpX +
    (midpoint.y - (source.y + target.y) / 2) * perpY;
  const side = bow < -MIN_BOW ? -1 : 1;

  // `|| 0` keeps a zero component as plain 0 rather than JavaScript's -0.
  return {
    x: Math.round(perpX * side * gap) || 0,
    y: Math.round(perpY * side * gap) || 0,
  };
}
