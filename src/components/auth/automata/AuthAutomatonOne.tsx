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
 * One cycle with a loop at the start, and the diagram this page opened with.
 *
 * q0 --b--> q1 (accepting), q1 --a--> q2, q2 --b--> q0, and a loop on a at q0.
 */
const Q0: State = { x: 103, y: 112, r: R };
const Q1: State = { x: 388, y: 67, r: R_ACCEPT };
const Q2: State = { x: 343, y: 182, r: R };

const ARROW = 'afct-automaton-one-arrow';
const loop = selfLoop(Q0);
const toQ1 = edgeBetween(Q0, Q1);
const toQ2 = edgeBetween(Q1, Q2);
const toQ0 = edgeBetween(Q2, Q0);
const OFF = -17;

export function AuthAutomatonOne({ className, style }: AutomatonProps) {
  return (
    <AutomatonFrame arrowId={ARROW} className={className} style={style}>
      <line x1="23" y1={Q0.y} x2={Q0.x - Q0.r - 4} y2={Q0.y} markerEnd={`url(#${ARROW})`} />

      <path d={loop.d} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...loop.label}>a</EdgeLabel>

      <line {...toQ1.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...toQ1.labelAt(OFF)}>b</EdgeLabel>

      <line {...toQ2.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...toQ2.labelAt(OFF)}>a</EdgeLabel>

      <line {...toQ0.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...toQ0.labelAt(OFF)}>b</EdgeLabel>

      <StateNode {...Q0} label="q0" />
      <StateNode {...Q1} label="q1" accepting />
      <StateNode {...Q2} label="q2" />
    </AutomatonFrame>
  );
}

export default AuthAutomatonOne;
