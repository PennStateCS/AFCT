import {
  AutomatonFrame,
  type AutomatonProps,
  EdgeLabel,
  R,
  R_ACCEPT,
  StateNode,
} from './AutomatonFrame';
import { edgeBetween, selfLoop, type State } from './geometry';

/**
 * A chain that runs left to right and sends one edge back, so the eye travels the width of
 * the frame and returns. q3 accepts.
 */
const Q0: State = { x: 58, y: 138, r: R };
const Q1: State = { x: 170, y: 118, r: R };
const Q2: State = { x: 285, y: 162, r: R };
const Q3: State = { x: 392, y: 112, r: R_ACCEPT };

const ARROW = 'afct-automaton-two-arrow';
const loop = selfLoop(Q1);
const e01 = edgeBetween(Q0, Q1);
const e12 = edgeBetween(Q1, Q2);
const e23 = edgeBetween(Q2, Q3);
const e31 = edgeBetween(Q3, Q1);
const OFF = -17;

export function AuthAutomatonTwo({ className, style }: AutomatonProps) {
  return (
    <AutomatonFrame arrowId={ARROW} className={className} style={style}>
      <line x1="20" y1={Q0.y} x2={Q0.x - Q0.r - 4} y2={Q0.y} markerEnd={`url(#${ARROW})`} />

      <path d={loop.d} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...loop.label}>0</EdgeLabel>

      <line {...e01.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...e01.labelAt(OFF)}>1</EdgeLabel>

      <line {...e12.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...e12.labelAt(OFF)}>1</EdgeLabel>

      <line {...e23.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...e23.labelAt(OFF)}>0</EdgeLabel>

      {/* The return, which passes above q2 rather than through it. */}
      <line {...e31.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...e31.labelAt(-16)}>1</EdgeLabel>

      <StateNode {...Q0} label="q0" />
      <StateNode {...Q1} label="q1" />
      <StateNode {...Q2} label="q2" />
      <StateNode {...Q3} label="q3" accepting />
    </AutomatonFrame>
  );
}

export default AuthAutomatonTwo;
