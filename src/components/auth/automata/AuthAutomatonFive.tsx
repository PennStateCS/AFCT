import {
  AutomatonFrame,
  type AutomatonProps,
  EdgeLabel,
  R,
  R_ACCEPT,
  StateNode,
} from './AutomatonFrame';
import { edgeBetween, parallelEdge, selfLoop, type State } from './geometry';

/**
 * The compact one, and the only diagram where the start state accepts.
 *
 * q0 and q1 pass control back and forth. Two straight edges between one pair would sit on top
 * of each other, so each is pushed to its own side of the centre line; they stay straight,
 * because only a state pointing at itself gets a curve.
 */
const Q0: State = { x: 100, y: 141, r: R_ACCEPT };
const Q1: State = { x: 255, y: 141, r: R };
const Q2: State = { x: 392, y: 141, r: R };

const ARROW = 'afct-automaton-five-arrow';
const loop0 = selfLoop(Q0);
const loop2 = selfLoop(Q2);
const there = parallelEdge(Q0, Q1, 16);
const back = parallelEdge(Q1, Q0, 16);
const e12 = edgeBetween(Q1, Q2);

export function AuthAutomatonFive({ className, style }: AutomatonProps) {
  return (
    <AutomatonFrame arrowId={ARROW} className={className} style={style}>
      <line x1="20" y1={Q0.y} x2={Q0.x - Q0.r - 4} y2={Q0.y} markerEnd={`url(#${ARROW})`} />

      <path d={loop0.d} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...loop0.label}>0</EdgeLabel>

      <line {...there.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...there.labelAt(15)}>1</EdgeLabel>

      <line {...back.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...back.labelAt(15)}>0</EdgeLabel>

      <line {...e12.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...e12.labelAt(-17)}>1</EdgeLabel>

      <path d={loop2.d} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...loop2.label}>0</EdgeLabel>

      <StateNode {...Q0} label="q0" accepting />
      <StateNode {...Q1} label="q1" />
      <StateNode {...Q2} label="q2" />
    </AutomatonFrame>
  );
}

export default AuthAutomatonFive;
