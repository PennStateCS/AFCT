import { describe, it, expect } from 'vitest';
import { bestStartNodePosition, NODE_DIAMETER } from './jflap-layout';

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
