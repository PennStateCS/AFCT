// src/lib/jflap-parse.ts
//
// Pure parsing/formatting for JFLAP (.jff) automaton files: XML → a normalized model,
// transition-label formatting, and conversion to the element list the cytoscape viewer
// renders. Extracted from JffViewerDialog so this logic lives (and is tested) on its own,
// independent of the imperative rendering. Uses DOMParser, which browsers and jsdom
// provide.

import { NODE_DIAMETER, noteBox, noteCentre } from './jflap-layout';

export type MachineType = 'fa' | 'pda' | 'tm' | 'unknown';

/**
 * The diameter JFLAP draws a state at, read out of `jars/afct-evaluator.jar`:
 * `gui/viewer/StateDrawer.STATE_RADIUS = 20`. Its transition labels are 12px, set in
 * `gui/viewer/AutomatonDrawer` with `deriveFont(12.0f)`.
 */
const JFLAP_STATE_DIAMETER = 40;

/**
 * How much to open out the coordinates in a .jff before drawing them.
 *
 * Whoever laid the machine out was dragging JFLAP's 40px states around, so the gaps they
 * left are only big enough for circles that size. This viewer draws a state at
 * NODE_DIAMETER, half again as wide, and using the saved coordinates as they stand spends
 * that extra width out of the space between states: labels then ran into the neighbouring
 * circles. Scaling every coordinate by the same ratio gives back the proportions the
 * machine was drawn with. It is a uniform scale, so the arrangement is untouched, and the
 * viewer fits the result to the canvas afterwards, so the machine is no smaller on screen
 * than it was, only less cramped.
 *
 * The viewer's own sizes (labels, loops, standoffs) are all in these same scaled units,
 * which is why this is one number here rather than a rescale of each of them.
 */
export const POSITION_SCALE = NODE_DIAMETER / JFLAP_STATE_DIAMETER;

export type Parsed = {
  type: MachineType;
  states: {
    id: string;
    name: string;
    xPos: number;
    yPos: number;
    initial: boolean;
    final: boolean;
  }[];
  transitions: Array<{
    from: string;
    to: string;
    read?: string;
    write?: string; // TM
    move?: string; // TM (L/R/S)
    pop?: string; // PDA
    push?: string; // PDA
    __idx: number; // original XML order
  }>;
  /**
   * Text the student wrote on the canvas beside the machine.
   *
   * JFLAP's note is a `javax.swing.JTextArea` (`automata/Note` in the evaluator jar), which is
   * why the text can contain line breaks, and why `xPos`/`yPos` are its **top-left corner**
   * rather than its centre the way a state's coordinates are.
   */
  notes: { text: string; xPos: number; yPos: number }[];
};

export function parseJflap(xmlText: string): Parsed {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    const msg = parseError.textContent?.split('\n')[0]?.trim() || 'XML parse error';
    throw new Error(`Invalid JFLAP (.jff) file: ${msg}`);
  }

  const automaton = doc.querySelector('structure > automaton') ?? doc;

  const rawType = (doc.querySelector('type')?.textContent || '').toLowerCase();
  let type: MachineType = 'unknown';
  if (rawType.includes('pda')) type = 'pda';
  else if (rawType.includes('turing') || rawType.includes('tm')) type = 'tm';
  else if (
    rawType.includes('fa') ||
    rawType.includes('finite') ||
    rawType.includes('dfa') ||
    rawType.includes('nfa')
  )
    type = 'fa';

  const states = Array.from(automaton.querySelectorAll('state')).map((s, i) => {
    const id = String(s.getAttribute('id') ?? i).trim();
    const name = s.getAttribute('name') ?? s.querySelector('name')?.textContent ?? `q${i}`;
    const xPos = parseInt(s.querySelector('x')?.textContent ?? '0');
    const yPos = parseInt(s.querySelector('y')?.textContent ?? '0');
    const initial = !!s.querySelector('initial');
    const final = !!s.querySelector('final');
    return { id, name, xPos, yPos, initial, final };
  });

  const transitions = Array.from(automaton.querySelectorAll('transition')).map((t, idx) => {
    const from = String(t.querySelector('from')?.textContent ?? '').trim();
    const to = String(t.querySelector('to')?.textContent ?? '').trim();
    const read = (t.querySelector('read')?.textContent ?? '').trim();
    const write = (t.querySelector('write')?.textContent ?? '').trim();
    const move = (t.querySelector('move')?.textContent ?? '').trim();
    const pop = (t.querySelector('pop')?.textContent ?? '').trim();
    const push = (t.querySelector('push')?.textContent ?? '').trim();
    return { from, to, read, write, move, pop, push, __idx: idx };
  });

  /**
   * Notes, which JFLAP writes as `<note><text>..</text><x>..</x><y>..</y></note>`.
   *
   * That is the whole of it: `file/xml/AutomatonTransducer` in the evaluator jar defines only
   * `NOTE_NAME` and `NOTE_TEXT_NAME` beside the shared coordinate names, and `automata/Note`
   * persists no id, size, colour or font.
   *
   * Coordinates are written as floats (`0.0`), so `parseInt` would work by accident and
   * `parseFloat` works on purpose.
   */
  const notes = Array.from(automaton.querySelectorAll('note'))
    .map((n) => {
      // The `<text>` child is where JFLAP puts it; the element's own text content is the
      // fallback for a file written by something else, and includes the coordinates, so it is
      // only reached when there is no `<text>` at all.
      const raw = n.querySelector('text')?.textContent ?? n.textContent ?? '';
      /**
       * Line endings, matched to what JFLAP itself draws.
       *
       * A real break in a JFLAP note arrives as CRLF, and becomes one line break here. A
       * **lone** carriage return is dropped rather than turned into a break, because that is
       * what JFLAP does with it: a note written as `properly&#13;and` renders as "properlyand"
       * in JFLAP's own editor, with no break and no space. Confirmed by opening the same file
       * in both, which is the only way to settle it.
       */
      const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '').trim();
      const xPos = parseFloat(n.querySelector('x')?.textContent ?? '');
      const yPos = parseFloat(n.querySelector('y')?.textContent ?? '');
      return { text, xPos, yPos };
    })
    // An empty note is one the student opened and never wrote in, and there is nothing to show.
    // A note with no usable position is dropped rather than drawn at the origin, where it would
    // sit on top of whatever is there and look deliberate.
    .filter((n) => n.text.length > 0 && Number.isFinite(n.xPos) && Number.isFinite(n.yPos));

  return { type, states, transitions, notes };
}

export function labelFor(t: Parsed['transitions'][number], type: MachineType, eps: string) {
  switch (type) {
    case 'pda': {
      const read = t.read || eps;
      const pop = t.pop || eps;
      const push = t.push || eps;
      return `${read} , ${pop} ; ${push}`;
    }
    case 'tm': {
      const read = t.read ?? '';
      const write = t.write ?? '';
      const move = (t.move || 'S').toUpperCase();
      return `${read || ' '} → ${write || ' '}, ${move}`;
    }
    case 'fa':
    default:
      return t.read || eps;
  }
}

export function wrapLines(lines: string[], maxLen = 26): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.length <= maxLen) {
      out.push(line);
      continue;
    }
    let s = line.trim();
    while (s.length > maxLen) {
      const slice = s.slice(0, maxLen + 8);
      const idx =
        slice.lastIndexOf(' ') >= 14
          ? slice.lastIndexOf(' ')
          : slice.lastIndexOf(',') >= 14
            ? slice.lastIndexOf(',')
            : slice.lastIndexOf(';') >= 14
              ? slice.lastIndexOf(';')
              : slice.lastIndexOf('|') >= 14
                ? slice.lastIndexOf('|')
                : maxLen;
      out.push(s.slice(0, idx).trim());
      s = s.slice(idx).replace(/^[\s,;|]+/, '');
    }
    if (s) out.push(s);
  }
  return out;
}

export function bundleEdges(
  transitions: Parsed['transitions'],
  type: MachineType,
  eps: string,
  wrap = true,
  maxLen = 26,
): Array<{ from: string; to: string; label: string }> {
  const map = new Map<string, { idx: number; text: string }[]>();
  for (const tr of transitions) {
    const key = `${tr.from}→${tr.to}`;
    const arr = map.get(key) ?? [];
    arr.push({ idx: tr.__idx, text: labelFor(tr, type, eps) });
    map.set(key, arr);
  }

  return Array.from(map.entries()).map(([key, items]) => {
    // JFLAP shows later-entered transitions first
    items.sort((a, b) => b.idx - a.idx);
    const [from = '', to = ''] = key.split('→');
    const lines = items.map((i) => i.text);
    const finalLines = wrap ? wrapLines(lines, maxLen) : lines;
    return { from, to, label: finalLines.join('\n') };
  });
}

export function toElements(parsed: Parsed, eps: string, honorPositions?: boolean) {
  const nodes = parsed.states.map((s) => {
    const base = {
      data: { id: s.id, label: s.name, final: s.final ? 1 : 0, initial: s.initial ? 1 : 0 },
      classes: s.final ? 'final' : '',
    };
    if (honorPositions) {
      return {
        ...base,
        position: { x: s.xPos * POSITION_SCALE, y: s.yPos * POSITION_SCALE },
        locked: false,
        grabbable: true,
      };
    }
    return base;
  });

  const edgesBundled = bundleEdges(parsed.transitions, parsed.type, eps, true, 26);
  const edges = edgesBundled.map((e, i) => ({
    data: {
      id: `e${i}-${e.from}-${e.to}`,
      source: e.from,
      target: e.to,
      label: e.label,
      isLoop: e.from === e.to ? 1 : 0,
    },
  }));

  /**
   * Notes, but only where the saved coordinates are being used.
   *
   * A note has nowhere to be in an auto-arranged graph: the layout has moved every state, so a
   * note left at the position the student chose ends up annotating whatever it happens to land
   * on, which is worse than not drawing it. `describeMachine` lists them either way, so they
   * are never unreachable.
   */
  /**
   * An id no state has taken.
   *
   * State ids come straight out of the file, so a student can name a state `jff-note-0`, and
   * cytoscape drops a duplicate id without saying anything: the note or the state would just
   * not be there. A prefix makes that unlikely; checking makes it impossible.
   */
  const takenIds = new Set(parsed.states.map((s) => s.id));
  const freeNoteId = (i: number) => {
    let id = `jff-note-${i}`;
    for (let n = 0; takenIds.has(id); n++) id = `jff-note-${i}-${n}`;
    takenIds.add(id);
    return id;
  };

  const notes = honorPositions
    ? parsed.notes.map((n, i) => {
        const size = noteBox(n.text);
        const centre = noteCentre({ x: n.xPos * POSITION_SCALE, y: n.yPos * POSITION_SCALE }, size);
        return {
          data: { id: freeNoteId(i), label: n.text, width: size.width, height: size.height },
          classes: 'note',
          position: centre,
          // Not part of the machine: it cannot be selected, dragged, or highlighted by a tap.
          selectable: false,
          grabbable: false,
        };
      })
    : [];

  return [...nodes, ...edges, ...notes];
}

/**
 * A plain-text description of a parsed machine, for the non-visual alternative to the
 * graph. Viewing automata is a core function of AFCT, so the canvas cannot be the only
 * representation: a screen reader user needs the states, which one is initial, which are
 * final, and every transition with its label.
 *
 * Pure and DOM-free so it can be unit tested and reused (summary line, expandable detail).
 */
export type MachineDescription = {
  /** One-line gist, suitable for aria-describedby on the graph container. */
  summary: string;
  stateNames: string[];
  initialState: string | null;
  finalStates: string[];
  /** Human-readable transitions, e.g. "q0 to q1 on a". */
  transitionLines: string[];
  /**
   * Text the student wrote on the canvas, one entry per note.
   *
   * Notes are content rather than decoration: the Similarity tab can tell a professor that two
   * pieces of text on the drawing match word for word, so somebody reading this instead of the
   * picture needs to be able to read the text that claim is about. Line breaks within a note
   * are flattened so one note stays one entry.
   */
  noteLines: string[];
  /** True when the file parsed but contains nothing to show. */
  isEmpty: boolean;
};

const MACHINE_NOUN: Record<MachineType, string> = {
  fa: 'Finite automaton',
  pda: 'Push-down automaton',
  tm: 'Turing machine',
  unknown: 'Automaton',
};

/**
 * A machine description as plain text, for pasting somewhere that is not a picture.
 *
 * The same content the viewer shows behind "Show text representation", laid out for an email
 * or a comment rather than for a screen reader walking a list. It is the only export that
 * survives being quoted: an SVG or a PNG of a student's automaton cannot be replied to inline.
 */
export function machineDescriptionText(description: MachineDescription): string {
  const lines: string[] = [description.summary, ''];

  if (description.stateNames.length > 0) {
    lines.push(`States: ${description.stateNames.join(', ')}`);
    lines.push(`Initial state: ${description.initialState ?? 'not set'}`);
    lines.push(
      `Final states: ${description.finalStates.length > 0 ? description.finalStates.join(', ') : 'none'}`,
    );
  }

  if (description.transitionLines.length > 0) {
    lines.push('', 'Transitions:');
    for (const line of description.transitionLines) lines.push(`  ${line}`);
  }

  // Notes are the student's own words, so they are quoted rather than summarised away.
  if (description.noteLines.length > 0) {
    lines.push('', 'Notes on the drawing:');
    for (const note of description.noteLines) lines.push(`  ${note}`);
  }

  return lines.join('\n');
}

/**
 * One transition touching a state, as the state's own panel lists it.
 *
 * Carries the transition's two ends as well as the text, so a row in that list can open the
 * transition's own properties: the panel that shows it knows which state it is describing, not
 * which line the reader wants next.
 */
export type StateLink = {
  direction: 'out' | 'in';
  /** The transition's ends, by id, which is what selects the drawn line. */
  from: string;
  to: string;
  /** The state at the other end, by name. A self-loop's other end is the state itself. */
  other: string;
  /** What it reads, formatted for the machine's type. */
  label: string;
};

/** One state, described for the panel that appears when a reader clicks it. */
export type StateDescription = {
  id: string;
  name: string;
  initial: boolean;
  final: boolean;
  /** "on a to q1", already formatted for the machine's type. */
  outgoing: string[];
  /** "from q0 on a". */
  incoming: string[];
  /** A self-loop appears in both lists; this is the count of distinct transitions touching it. */
  degree: number;
  /**
   * The same transitions as `outgoing` and `incoming`, in their parts and in one list.
   *
   * A self-loop is one entry here rather than two: it leaves and arrives at the same state, and
   * a list that showed it twice would read as two transitions.
   */
  links: StateLink[];
};

/**
 * Describe a single state.
 *
 * Shares `labelFor` with the whole-machine description, so a transition never reads one way in
 * the panel and another in the text representation. Returns null for an id the machine does not
 * have, which is what a click on a note or a start marker would produce.
 */
export function describeState(parsed: Parsed, id: string, eps: string): StateDescription | null {
  const state = parsed.states.find((s) => s.id === id);
  if (!state) return null;

  const nameById = new Map(parsed.states.map((s) => [s.id, s.name || s.id]));
  const nameOf = (target: string) => nameById.get(target) ?? target;

  const ordered = [...parsed.transitions].sort((a, b) => a.__idx - b.__idx);
  const outgoing = ordered
    .filter((t) => t.from === id)
    .map((t) => `on ${labelFor(t, parsed.type, eps)} to ${nameOf(t.to)}`);
  const incoming = ordered
    .filter((t) => t.to === id)
    .map((t) => `from ${nameOf(t.from)} on ${labelFor(t, parsed.type, eps)}`);

  const links: StateLink[] = ordered
    .filter((t) => t.from === id || t.to === id)
    .map((t) => ({
      // A self-loop is listed once, as something the state does rather than something done to it.
      direction: t.from === id ? ('out' as const) : ('in' as const),
      from: t.from,
      to: t.to,
      other: nameOf(t.from === id ? t.to : t.from),
      label: labelFor(t, parsed.type, eps),
    }));

  return {
    id: state.id,
    name: state.name || state.id,
    initial: state.initial,
    final: state.final,
    outgoing,
    incoming,
    degree: ordered.filter((t) => t.from === id || t.to === id).length,
    links,
  };
}

/**
 * One of the transitions behind a drawn edge, with the fields its machine type uses.
 *
 * Which fields those are is the whole point: a finite automaton's transition reads a symbol, a
 * pushdown automaton's also pops and pushes, and a Turing machine's writes and moves. `index` is
 * the transition's place in the file, which is what identifies it when one of several between
 * the same two states is edited.
 */
export type TransitionDescription = {
  index: number;
  /** What the drawing shows for this one transition. */
  label: string;
  read: string;
  /** PDA only. */
  pop?: string;
  push?: string;
  /** TM only. */
  write?: string;
  move?: string;
};

/** The transitions drawn as one edge between a pair of states. */
export type EdgeDescription = {
  from: string;
  to: string;
  /** True when both ends are the same state, which is drawn as a loop. */
  selfLoop: boolean;
  /** One entry per transition, already formatted for the machine's type. */
  labels: string[];
  /** The same transitions in their parts, for a panel that lets them be changed. */
  transitions: TransitionDescription[];
};

/** The parts of a transition a reader can change, which differ by machine type. */
export type TransitionField = 'read' | 'pop' | 'push' | 'write' | 'move';

/** The fields a transition of this machine type actually has. */
export function transitionFields(type: MachineType): TransitionField[] {
  if (type === 'pda') return ['read', 'pop', 'push'];
  if (type === 'tm') return ['read', 'write', 'move'];
  return ['read'];
}

/**
 * Describe the edge between two states.
 *
 * An edge is not a transition. Parallel transitions between the same pair are bundled into one
 * line on the canvas with a combined label, so clicking it asks about all of them: a panel that
 * showed only the first would be quietly wrong on exactly the machines where it matters, the
 * ones with several ways to get from one state to another.
 *
 * Returns null when no transition joins the two, which is what a click on something that is not
 * an edge would produce.
 */
export function describeEdge(
  parsed: Parsed,
  from: string,
  to: string,
  eps: string,
): EdgeDescription | null {
  const nameById = new Map(parsed.states.map((st) => [st.id, st.name || st.id]));
  const nameOf = (id: string) => nameById.get(id) ?? id;

  const matching = [...parsed.transitions]
    .sort((a, b) => a.__idx - b.__idx)
    .filter((t) => t.from === from && t.to === to);

  if (matching.length === 0) return null;

  const labels = matching.map((t) => labelFor(t, parsed.type, eps));
  const transitions = matching.map((t) => ({
    index: t.__idx,
    label: labelFor(t, parsed.type, eps),
    read: t.read ?? '',
    ...(parsed.type === 'pda' ? { pop: t.pop ?? '', push: t.push ?? '' } : {}),
    ...(parsed.type === 'tm' ? { write: t.write ?? '', move: t.move ?? '' } : {}),
  }));

  return { from: nameOf(from), to: nameOf(to), selfLoop: from === to, labels, transitions };
}

export function describeMachine(parsed: Parsed, eps: string): MachineDescription {
  const nameById = new Map(parsed.states.map((s) => [s.id, s.name || s.id]));
  const nameOf = (id: string) => nameById.get(id) ?? id;

  const stateNames = parsed.states.map((s) => s.name || s.id);
  const initialState = parsed.states.find((s) => s.initial)?.name ?? null;
  const finalStates = parsed.states.filter((s) => s.final).map((s) => s.name || s.id);

  // Keep the original XML order so the text matches the order the file declares.
  const transitionLines = [...parsed.transitions]
    .sort((a, b) => a.__idx - b.__idx)
    .map((t) => `${nameOf(t.from)} to ${nameOf(t.to)} on ${labelFor(t, parsed.type, eps)}`);

  const noteLines = parsed.notes.map((n) => n.text.replace(/\s*\n\s*/g, ' ').trim());

  // A file can hold notes and no states, and a student who wrote only a note has not submitted
  // an empty file: saying "nothing to show" would be wrong, and would hide the one thing in it.
  const isEmpty = parsed.states.length === 0 && noteLines.length === 0;
  const noun = MACHINE_NOUN[parsed.type] ?? MACHINE_NOUN.unknown;

  // Said in the summary as well as listed below it, because the summary is the whole of what
  // `aria-describedby` gives the canvas: without this, a screen-reader user is not told the
  // notes exist unless they happen to expand the detail.
  const noteNote =
    noteLines.length === 0
      ? ''
      : ` ${noteLines.length} ${noteLines.length === 1 ? 'note' : 'notes'} written on the drawing.`;

  const summary =
    (parsed.states.length === 0
      ? `${noun} with no states.`
      : `${noun} with ${parsed.states.length} ${parsed.states.length === 1 ? 'state' : 'states'} ` +
        `and ${parsed.transitions.length} ${parsed.transitions.length === 1 ? 'transition' : 'transitions'}. ` +
        `Initial state ${initialState ?? 'not set'}. ` +
        `${
          finalStates.length === 0
            ? 'No final states.'
            : `Final ${finalStates.length === 1 ? 'state' : 'states'} ${finalStates.join(', ')}.`
        }`) + noteNote;

  return { summary, stateNames, initialState, finalStates, transitionLines, noteLines, isEmpty };
}
