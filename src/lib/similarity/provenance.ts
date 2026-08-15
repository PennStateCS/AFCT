// Provenance features: the marks a file carries from wherever it came from.
//
// The two hashes either side of this answer "is this the same file" and "is this the same
// work". Both are all-or-nothing, so a copied file that has had a transition added, a state
// deleted or the whole drawing moved is invisible to them. This module describes a
// submission in small pieces instead, so two files can be found to share most of their
// pieces without being equal in any of them.
//
// Everything here is extracted from the file alone, at upload time, and is deliberately
// small: a description of the artifact, never a second copy of it. Nothing here decides
// anything; `near-matches.ts` does the comparing, and an instructor does the judging.
//
// What is NOT used, on purpose: the order `<state>` and `<transition>` elements appear in
// the XML. JFLAP's serialisation does not make that a record of the order things were
// created in, so treating it as edit history would be inventing evidence.

import { DOMParser } from '@xmldom/xmldom';
import type { Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom';

/** Bump when the meaning of any feature changes, so old rows can be told apart. */
export const PROVENANCE_FEATURE_VERSION = 1;

export type ProvenanceFeatures = {
  version: number;
  /** fa, pda, tm, grammar, re, or unknown. Comparison never crosses types. */
  machineType: string;
  stateCount: number;
  transitionCount: number;
  /**
   * Every feature as a short prefixed string, so one rule can weigh them all by how common
   * they are in the class:
   *
   * - `f:` local structure. What a state looks like from where it stands (initial/final,
   *   the labels coming in and going out), and what each transition connects. A machine
   *   with one transition changed still shares every fragment the change did not touch.
   * - `t:` original state-id topology. JFLAP's ids are not the visible names and survive
   *   renaming, so the same id pairs appearing in two files is a mark of common origin.
   *   Ids alone mean nothing; it is the pairs that carry the signal.
   * - `g:` normalised geometry. Where the states sit relative to each other, with the whole
   *   drawing moved to a common origin and scaled, so translating or resizing it changes
   *   nothing.
   * - `c:` transition control points, placed relative to the states they join. A student who
   *   moves states around often leaves hand-adjusted curvature exactly where it was.
   * - `u:` the oddities: a state nothing reaches, a state nothing can accept from, a
   *   transition entered twice. A shared mistake says more than shared correctness.
   * - `l:` and `n:` what was written on the drawing: state labels and sticky notes, compared
   *   exactly.
   * - `b:` Turing-machine building blocks: their names, their size, and the identifiers
   *   inside them, kept apart from the top-level ones because they start again from zero.
   */
  features: string[];
};

/** A state as this module needs it: identity, role, position, and whatever it was labelled. */
type StateInfo = {
  id: string;
  initial: boolean;
  final: boolean;
  x: number | null;
  y: number | null;
  /** JFLAP's own state label, which is not the name. Usually empty. */
  label: string;
};

type TransitionInfo = {
  from: string;
  to: string;
  /** read/pop/push for a PDA, read/write/move for a TM; whatever the type carries. */
  label: string;
  control: { x: number; y: number } | null;
};

const text = (node: XmlElement, tag: string): string =>
  (node.getElementsByTagName(tag).item(0)?.textContent ?? '').trim();

const numberOrNull = (raw: string): number | null => {
  // An absent element reads as an empty string, and `Number('')` is 0, which would have put
  // every transition without a control point at the origin and every state with no
  // coordinates at (0, 0). Absent has to stay absent.
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const toState = (state: XmlElement): StateInfo => ({
  id: state.getAttribute('id') ?? '',
  initial: state.getElementsByTagName('initial').length > 0,
  final: state.getElementsByTagName('final').length > 0,
  x: numberOrNull(text(state, 'x')),
  y: numberOrNull(text(state, 'y')),
  label: text(state, 'label'),
});

/** Direct children only: a Turing machine's blocks hold automata of their own. */
function childrenNamed(parent: XmlElement, tag: string): XmlElement[] {
  return Array.from(parent.childNodes ?? []).filter(
    (node): node is XmlElement => (node as XmlElement).nodeName === tag,
  );
}

function readStates(doc: XmlDocument): StateInfo[] {
  return Array.from(doc.getElementsByTagName('state')).map(toState);
}

const toTransition = (transition: XmlElement): TransitionInfo => {
  // Everything except the endpoints and the control point is what the transition reads,
  // pops, pushes, writes or moves; it differs by machine type, so take it as it comes.
  const label = Array.from(transition.getElementsByTagName('*'))
    .filter((node) => !['from', 'to', 'controlx', 'controly'].includes(node.nodeName))
    .map((node) => `${node.nodeName}=${(node.textContent ?? '').trim()}`)
    .sort()
    .join(',');

  const controlX = numberOrNull(text(transition, 'controlx'));
  const controlY = numberOrNull(text(transition, 'controly'));

  return {
    from: text(transition, 'from'),
    to: text(transition, 'to'),
    label,
    control: controlX !== null && controlY !== null ? { x: controlX, y: controlY } : null,
  };
};

function readTransitions(doc: XmlDocument): TransitionInfo[] {
  return Array.from(doc.getElementsByTagName('transition')).map(toTransition);
}

/**
 * What a state looks like from where it stands: whether it starts or accepts, and the
 * labels on the transitions arriving and leaving. No id and no name, so this survives both
 * renaming and renumbering, and only the states an edit actually touched change.
 */
function localSignatures(
  states: StateInfo[],
  transitions: TransitionInfo[],
): Map<string, string> {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const transition of transitions) {
    outgoing.set(transition.from, [...(outgoing.get(transition.from) ?? []), transition.label]);
    incoming.set(transition.to, [...(incoming.get(transition.to) ?? []), transition.label]);
  }

  const signatures = new Map<string, string>();
  for (const state of states) {
    const role = `${state.initial ? 'i' : ''}${state.final ? 'f' : ''}` || '-';
    const inLabels = (incoming.get(state.id) ?? []).slice().sort().join('|');
    const outLabels = (outgoing.get(state.id) ?? []).slice().sort().join('|');
    signatures.set(state.id, `${role}<${inLabels}>${outLabels}`);
  }
  return signatures;
}

/**
 * A state described only by its role and how many transitions touch it. Coarser than the
 * label signature above, and therefore intact when a label somewhere changes.
 */
function degreeSignatures(
  states: StateInfo[],
  transitions: TransitionInfo[],
): Map<string, string> {
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const transition of transitions) {
    outDegree.set(transition.from, (outDegree.get(transition.from) ?? 0) + 1);
    inDegree.set(transition.to, (inDegree.get(transition.to) ?? 0) + 1);
  }

  return new Map(
    states.map((state) => [
      state.id,
      `${state.initial ? 'i' : ''}${state.final ? 'f' : ''}|${inDegree.get(state.id) ?? 0},${outDegree.get(state.id) ?? 0}`,
    ]),
  );
}

/**
 * Where the states sit relative to each other, described one transition at a time: the step
 * from each state to the one it points at, measured against the typical step in the drawing.
 *
 * Relative, so moving the whole machine changes nothing; scaled, so resizing it changes
 * nothing; and local, so dragging one state out of place only changes the few steps that
 * touch it, leaving the rest of the layout still recognisable. Describing absolute
 * positions instead, however cleverly normalised, fails that last part: with a handful of
 * states, one of them moving shifts whatever the others are measured against.
 */
function geometryCells(states: StateInfo[], transitions: TransitionInfo[]): string[] {
  const byId = new Map(
    states
      .filter(
        (state): state is StateInfo & { x: number; y: number } =>
          state.x !== null && state.y !== null,
      )
      .map((state) => [state.id, state]),
  );

  const steps: { from: string; dx: number; dy: number }[] = [];
  for (const transition of transitions) {
    if (transition.from === transition.to) continue;
    const from = byId.get(transition.from);
    const to = byId.get(transition.to);
    if (!from || !to) continue;
    steps.push({ from: transition.from, dx: to.x - from.x, dy: to.y - from.y });
  }
  if (steps.length === 0) return [];

  // The typical step, which one state moving barely disturbs.
  const scale = median(steps.map((step) => Math.hypot(step.dx, step.dy)));
  if (scale < 1) return [];

  const CELLS = 4;
  return steps.map(
    (step) =>
      `${Math.round((step.dx / scale) * CELLS)},${Math.round((step.dy / scale) * CELLS)}`,
  );
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0);
}

/**
 * A control point described relative to the transition it belongs to: how far along the
 * line between the two states it sits, and how far off to one side. Moving the states then
 * leaves the curvature feature unchanged, which is the point of recording it.
 */
function controlFeatures(states: StateInfo[], transitions: TransitionInfo[]): string[] {
  const byId = new Map(states.map((state) => [state.id, state]));
  const features: string[] = [];

  for (const transition of transitions) {
    if (!transition.control) continue;
    const from = byId.get(transition.from);
    const to = byId.get(transition.to);
    if (!from || !to || from.x === null || from.y === null || to.x === null || to.y === null) {
      continue;
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    // A self-loop has no direction to measure against; its control point is recorded as
    // simply being present rather than placed.
    if (length < 1) {
      features.push('self');
      continue;
    }

    const cx = transition.control.x - from.x;
    const cy = transition.control.y - from.y;
    const along = (cx * dx + cy * dy) / (length * length);
    const across = (cx * dy - cy * dx) / (length * length);
    features.push(`${Math.round(along * 10)},${Math.round(across * 10)}`);
  }

  return features;
}

/** Productions as written, before the shape hash sorts them and forgets the names. */
function grammarFeatures(doc: XmlDocument): string[] {
  const productions = Array.from(doc.getElementsByTagName('production'));
  if (productions.length === 0) return [];

  const written = productions.map((production) => {
    const left = text(production, 'left');
    const right = text(production, 'right');
    return `${left}->${right}`;
  });

  // Each production as written, plus each adjacent pair, so the order they were typed in is
  // itself a weak feature without the whole grammar having to match.
  const features = written.map((line) => `f:p:${line}`);
  for (let index = 1; index < written.length; index++) {
    features.push(`f:pp:${written[index - 1]}>${written[index]}`);
  }
  return features;
}


/**
 * The states a machine does not need, and the transitions it has twice.
 *
 * Shared correct structure is what a class produces; a shared oddity is not. A state
 * nothing can reach, a state from which nothing can accept, or the same transition entered
 * twice are all the kind of thing that gets carried along when a file is passed on and
 * edited, and each is keyed on what the state looks like rather than on its name, so it
 * survives renaming.
 *
 * A trap state is perfectly ordinary in a complete DFA, so this cannot mean anything on its
 * own. That is what the class-frequency weighting is for: if half the class has one, it
 * counts for nothing.
 */
function oddityFeatures(
  states: StateInfo[],
  transitions: TransitionInfo[],
  signatures: Map<string, string>,
): string[] {
  const features: string[] = [];
  const outgoing = new Map<string, TransitionInfo[]>();
  for (const transition of transitions) {
    outgoing.set(transition.from, [...(outgoing.get(transition.from) ?? []), transition]);
  }

  const initial = states.find((state) => state.initial);
  if (initial) {
    const reachable = new Set<string>([initial.id]);
    const queue = [initial.id];
    while (queue.length > 0) {
      for (const transition of outgoing.get(queue.pop() as string) ?? []) {
        if (reachable.has(transition.to)) continue;
        reachable.add(transition.to);
        queue.push(transition.to);
      }
    }
    for (const state of states) {
      if (!reachable.has(state.id)) {
        features.push(`u:unreachable:${signatures.get(state.id) ?? ''}`);
      }
    }
  }

  // Backwards from the accepting states: anything they cannot be reached from is a dead end.
  const incoming = new Map<string, string[]>();
  for (const transition of transitions) {
    incoming.set(transition.to, [...(incoming.get(transition.to) ?? []), transition.from]);
  }
  const accepting = states.filter((state) => state.final).map((state) => state.id);
  if (accepting.length > 0) {
    const canAccept = new Set<string>(accepting);
    const queue = [...accepting];
    while (queue.length > 0) {
      for (const from of incoming.get(queue.pop() as string) ?? []) {
        if (canAccept.has(from)) continue;
        canAccept.add(from);
        queue.push(from);
      }
    }
    for (const state of states) {
      if (!canAccept.has(state.id)) {
        features.push(`u:dead:${signatures.get(state.id) ?? ''}`);
      }
    }
  }

  const seen = new Set<string>();
  for (const transition of transitions) {
    const key = `${signatures.get(transition.from) ?? ''}-[${transition.label}]->${signatures.get(transition.to) ?? ''}`;
    if (seen.has(key)) features.push(`u:repeated:${key}`);
    seen.add(key);
  }

  return features;
}

/**
 * What somebody wrote on the drawing: state labels and sticky notes.
 *
 * Compared exactly, never fuzzily. Two students choosing the same unusual wording is worth
 * knowing; deciding that two different notes are "similar enough" is exactly the kind of
 * judgement this system should not be making. Empty text is skipped, and text half the class
 * wrote is dropped later by the same weighting as everything else.
 */
function writtenFeatures(doc: XmlDocument, states: StateInfo[]): string[] {
  const features: string[] = [];

  for (const state of states) {
    if (state.label) features.push(`l:${state.label}`);
  }

  for (const note of Array.from(doc.getElementsByTagName('note'))) {
    // JFLAP keeps the note's text in a child element alongside its position; take the text
    // and leave the position, which says nothing a moved note would not break.
    const body = (text(note, 'text') || (note.textContent ?? '')).trim();
    if (body) features.push(`n:${body}`);
  }

  return features;
}

/**
 * A Turing machine's building blocks: what they are called, how big each one is, and the
 * state identifiers inside them.
 *
 * Two people who decompose a machine into the same blocks, with the same names and the same
 * insides, have made the same unusual choice. Ids inside a block start again from zero, so
 * they are recorded against the block they belong to rather than being thrown in with the
 * top-level ones, where they would collide with them and invent matches.
 */
function blockFeatures(doc: XmlDocument): string[] {
  const blocks = Array.from(doc.getElementsByTagName('block'));
  if (blocks.length === 0) return [];

  const features: string[] = [];
  for (const block of blocks) {
    const name = (block.getAttribute('name') ?? text(block, 'name')).trim();
    if (!name) continue;
    features.push(`b:${name}`);

    // The block's own machine, if it carries one.
    const inner = childrenNamed(block, 'automaton')[0];
    if (!inner) continue;

    const innerStates = childrenNamed(inner, 'state').map(toState);
    const innerTransitions = childrenNamed(inner, 'transition').map(toTransition);
    features.push(`b:${name}:${innerStates.length},${innerTransitions.length}`);
    for (const transition of innerTransitions) {
      features.push(`b:${name}:${transition.from}>${transition.to}`);
    }
  }
  return features;
}

/**
 * Describe a submission. Returns null when there is nothing useful to describe, which is
 * the honest answer for a regular expression and for anything that will not parse.
 */
export function extractProvenanceFeatures(content: Buffer | string): ProvenanceFeatures | null {
  const raw = typeof content === 'string' ? content : content.toString('utf8');
  if (!raw.includes('<structure')) return null;

  let doc: XmlDocument;
  try {
    doc = new DOMParser().parseFromString(raw, 'text/xml');
  } catch {
    return null;
  }
  if (!doc.getElementsByTagName('structure').item(0)) return null;

  const machineType = (doc.getElementsByTagName('type').item(0)?.textContent ?? '')
    .trim()
    .toLowerCase();

  const states = readStates(doc);
  const transitions = readTransitions(doc);

  if (states.length === 0) {
    const grammar = grammarFeatures(doc);
    if (grammar.length === 0) return null;
    return {
      version: PROVENANCE_FEATURE_VERSION,
      machineType: machineType || 'grammar',
      stateCount: 0,
      transitionCount: 0,
      features: [...new Set(grammar)],
    };
  }

  const signatures = localSignatures(states, transitions);
  const degrees = degreeSignatures(states, transitions);
  const features: string[] = [];

  // Local structure at two grains. The fine one is precise and rare, and so counts for a
  // lot when it is shared; but changing one transition rewrites the signature of both
  // states it touches and every fragment mentioning them. The coarse one survives that,
  // and being commoner it is weighted down accordingly. Rarity sorts out which mattered.
  for (const state of states) {
    features.push(`f:s:${signatures.get(state.id) ?? ''}`);
    features.push(`f:sd:${degrees.get(state.id) ?? ''}`);
  }
  for (const transition of transitions) {
    const from = signatures.get(transition.from) ?? '?';
    const to = signatures.get(transition.to) ?? '?';
    features.push(`f:e:${from}-[${transition.label}]->${to}`);
    features.push(
      `f:el:${degrees.get(transition.from) ?? '?'}-[${transition.label}]->${degrees.get(transition.to) ?? '?'}`,
    );
  }

  // Original ids, which are not the visible names and survive renaming.
  for (const transition of transitions) {
    features.push(`t:${transition.from}>${transition.to}`);
  }

  for (const cell of geometryCells(states, transitions)) features.push(`g:${cell}`);
  for (const control of controlFeatures(states, transitions)) features.push(`c:${control}`);
  features.push(...oddityFeatures(states, transitions, signatures));
  features.push(...writtenFeatures(doc, states));
  features.push(...blockFeatures(doc));

  return {
    version: PROVENANCE_FEATURE_VERSION,
    machineType: machineType || 'unknown',
    stateCount: states.length,
    transitionCount: transitions.length,
    // Deduplicated: a feature is something the file has, not something it has twice. Keeps
    // the stored record small and stops a repeated structure counting several times.
    features: [...new Set(features)],
  };
}
