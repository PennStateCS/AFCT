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
 * The widest of the five: the input splits, the upper branch takes a step the lower one does
 * not, and both arrive at q4, which accepts and then keeps itself.
 */
const Q0: State = { x: 55, y: 127, r: R };
const Q1: State = { x: 165, y: 70, r: R };
const Q2: State = { x: 165, y: 184, r: R };
const Q3: State = { x: 288, y: 70, r: R };
const Q4: State = { x: 386, y: 127, r: R_ACCEPT };

/** The middle of this drawing's bounding box; see AutomatonFrame. */
const CENTER = [218, 126] as const;

const ARROW = 'afct-automaton-four-arrow';
const loop = selfLoop(Q4);
const e01 = edgeBetween(Q0, Q1);
const e02 = edgeBetween(Q0, Q2);
const e13 = edgeBetween(Q1, Q3);
const e34 = edgeBetween(Q3, Q4);
const e24 = edgeBetween(Q2, Q4);

export function AuthAutomatonFour({ className, style }: AutomatonProps) {
  return (
    <AutomatonFrame arrowId={ARROW} className={className} style={style} center={CENTER}>
      <line x1="18" y1={Q0.y} x2={Q0.x - Q0.r - 4} y2={Q0.y} markerEnd={`url(#${ARROW})`} />

      <line {...e01.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...e01.labelAt(-16)}>0</EdgeLabel>

      <line {...e02.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...e02.labelAt(16)}>1</EdgeLabel>

      <line {...e13.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...e13.labelAt(-16)}>1</EdgeLabel>

      <line {...e34.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...e34.labelAt(-16)}>0</EdgeLabel>

      <line {...e24.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...e24.labelAt(16)}>1</EdgeLabel>

      <path d={loop.d} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...loop.label}>0</EdgeLabel>

      <StateNode {...Q0} label="q0" />
      <StateNode {...Q1} label="q1" />
      <StateNode {...Q2} label="q2" />
      <StateNode {...Q3} label="q3" />
      <StateNode {...Q4} label="q4" accepting />
    </AutomatonFrame>
  );
}

export default AuthAutomatonFour;
