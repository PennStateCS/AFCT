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
      // JFLAP writes the line breaks of a multi-line note as carriage returns (`&#13;`).
      const text = raw.replace(/\r\n?/g, '\n').trim();
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
