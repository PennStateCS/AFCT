// src/lib/jflap-layout.ts
//
// Pure geometry for placing a finite-automaton "start" stub next to its initial state.
// Extracted from JffViewerDialog, where the same clutter-scoring loop was duplicated
// (initial layout + drag reposition), so it can live and be tested on its own.

export type Point = { x: number; y: number };

/** Diameter of a state node in the JFLAP viewer; sets the overlap threshold. */
export const NODE_DIAMETER = 58;

/**
 * Choose where to place the start-arrow stub for an initial node: try 8 compass
 * directions at 1.5× the node diameter and pick the least-cluttered one — penalizing
 * overlap with other nodes and alignment with incoming edges. Returns the chosen point.
 */
export function bestStartNodePosition(
  nodePos: Point,
  otherNodePositions: Point[],
  incomingAngles: number[],
  nodeDiameter: number = NODE_DIAMETER,
): Point {
  const directions = Array.from({ length: 8 }, (_, i) => i * (Math.PI / 4)); // 0,45,…,315°
  const radius = 1.5 * nodeDiameter;

  const scores = directions.map((angle) => {
    const testX = nodePos.x + Math.cos(angle) * radius;
    const testY = nodePos.y + Math.sin(angle) * radius;

    let score = 0;
    for (const pos of otherNodePositions) {
      const dx = testX - pos.x;
      const dy = testY - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nodeDiameter * 1.1)
        score += 1000; // heavy penalty for overlap
      else score += 1 / dist;
    }

    for (const edgeAngle of incomingAngles) {
      let diff = Math.abs(angle - edgeAngle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff < Math.PI / 6) score += 10; // within 30° of an incoming edge
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

  const bestAngle = directions[bestIdx] ?? 0;
  return {
    x: nodePos.x + Math.cos(bestAngle) * radius,
    y: nodePos.y + Math.sin(bestAngle) * radius,
  };
}
