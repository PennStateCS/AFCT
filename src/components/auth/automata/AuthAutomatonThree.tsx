import {
  AutomatonFrame,
  type AutomatonProps,
  EdgeLabel,
  R,
  R_ACCEPT,
  StateNode,
} from './AutomatonFrame';
import { edgeBetween, type State } from './geometry';

/**
 * A diamond: the input splits at q0 and the two branches meet again at q3, which accepts.
 * The only one of the five with no self-transition, which is what makes its rhythm different.
 */
const Q0: State = { x: 70, y: 117, r: R };
const Q1: State = { x: 222, y: 62, r: R };
const Q2: State = { x: 222, y: 172, r: R };
const Q3: State = { x: 378, y: 117, r: R_ACCEPT };

/** The middle of this drawing's bounding box; see AutomatonFrame. */
const CENTER = [215, 117] as const;

const ARROW = 'afct-automaton-three-arrow';
const e01 = edgeBetween(Q0, Q1);
const e02 = edgeBetween(Q0, Q2);
const e13 = edgeBetween(Q1, Q3);
const e23 = edgeBetween(Q2, Q3);

export function AuthAutomatonThree({ className, style }: AutomatonProps) {
  return (
    <AutomatonFrame arrowId={ARROW} className={className} style={style} center={CENTER}>
      <line x1="20" y1={Q0.y} x2={Q0.x - Q0.r - 4} y2={Q0.y} markerEnd={`url(#${ARROW})`} />

      <line {...e01.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...e01.labelAt(-17)}>0</EdgeLabel>

      <line {...e02.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...e02.labelAt(17)}>1</EdgeLabel>

      <line {...e13.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...e13.labelAt(17)}>1</EdgeLabel>

      <line {...e23.line} strokeLinecap="round" markerEnd={`url(#${ARROW})`} />
      <EdgeLabel {...e23.labelAt(-17)}>0</EdgeLabel>

      <StateNode {...Q0} label="q0" />
      <StateNode {...Q1} label="q1" />
      <StateNode {...Q2} label="q2" />
      <StateNode {...Q3} label="q3" accepting />
    </AutomatonFrame>
  );
}

export default AuthAutomatonThree;
