// The fingerprint every submission carries: one hash of what the student actually sent.
//
// Computed on the server when the file arrives, for both submission paths, so it does not
// depend on the native client writing anything into the file and cannot be avoided by
// submitting through the web app instead. It is also computed outside grading, so a
// problem with autograding off still gets one and a failure here can never cost a grade.
//
// What it is for: finding submissions that are the same file. Equality alone is NOT
// evidence of copying, because students converge on the same right answer, and CFG and RE
// files carry no layout at all so identical answers really are identical files. The
// meaning comes from how rare a hash is within one problem, which is what the matching
// query works out; see `lib/similarity/matches`.

import { createHash } from 'crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom';
import { childrenNamed, machineElements } from './jff-elements';

/**
 * The `<structure>` element on its own, with layout-irrelevant text removed.
 *
 * Everything outside `<structure>` is dropped: the XML declaration, JFLAP's own "Created
 * with" comment, and the hash comments the native client appends. Two files holding the
 * same automaton therefore hash the same whether they came from the client or the browser,
 * and whether they were saved by JFLAP 4 or 7.
 *
 * Whitespace *between* tags goes too, along with the `&#13;` carriage returns JFLAP writes,
 * so a file that has been through a Windows editor still matches its original. Whitespace
 * inside a value is kept: a grammar production is its text, and "a S b" is not "aSb".
 */
function canonicalStructureXml(text: string): string | null {
  if (!text.includes('<structure')) return null;
  try {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const structure = doc.getElementsByTagName('structure').item(0);
    if (!structure) return null;

    return new XMLSerializer()
      .serializeToString(structure)
      .replace(/&#13;/g, '')
      .replace(/\r/g, '')
      .replace(/>\s+</g, '><')
      .trim();
  } catch {
    return null;
  }
}

/**
 * Plain-text fallback for a submission that is not JFLAP XML (a `.txt` regular expression,
 * say). Line endings and trailing spaces are normalised so the same answer typed on
 * Windows and on macOS hashes the same.
 */
function canonicalText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

/**
 * The stored fingerprint for a submitted file. Returns null only for an empty file, which
 * has nothing to compare.
 *
 * Deliberately NOT the same value as `calcHashData`, which exists to be compared against
 * the hash the native client writes into the file and so has to reproduce that client's
 * exact serialisation. This one answers a different question and is free to normalise.
 */
export function submissionContentHash(content: Buffer | string): string | null {
  const text = typeof content === 'string' ? content : content.toString('utf8');
  if (!text.trim()) return null;

  const canonical = canonicalStructureXml(text) ?? canonicalText(text);
  if (!canonical) return null;

  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * The same submission with everything incidental taken out: where the states sit, what they
 * are called, and the order things happen to be written in.
 *
 * This is the second fingerprint, and it answers a different question from the first. Two
 * files with the same `contentHash` are the same file. Two files with the same shape hash
 * are the same machine drawn differently, which is what a copied file looks like after
 * somebody drags the nodes around or renames the states, the two easiest things to do to a
 * file you did not write.
 *
 * State ids are kept and renumbered in order, not canonicalised across isomorphism. That
 * would make every correct answer to an easy problem collide, and it is not needed for what
 * this catches: editing a file you were given leaves the ids alone.
 */
function shapeOfAutomaton(doc: XmlDocument): string | null {
  const structure = doc.getElementsByTagName('structure').item(0);
  if (!structure) return null;

  const type = (doc.getElementsByTagName('type').item(0)?.textContent ?? '').trim().toLowerCase();

  // The machine's own states and transitions. A building block holds an automaton of its
  // own, whose states start again from id zero; mixing those in here would both inflate the
  // machine and collide with its ids. The blocks are described separately, below.
  const states = machineElements(doc, 'state');
  if (states.length === 0) return null;

  const lines = machineLines(states, machineElements(doc, 'transition'));
  return [type, ...lines, ...blockShapeLines(doc)].join('|');
}

const childText = (node: XmlElement, tag: string): string =>
  (node.getElementsByTagName(tag).item(0)?.textContent ?? '').trim();

/** Everything a transition carries besides its endpoints: read/pop/push, read/write/move. */
function transitionLabel(transition: XmlElement): string {
  return Array.from(transition.getElementsByTagName('*'))
    .filter((node) => node.nodeName !== 'from' && node.nodeName !== 'to')
    .map((node) => `${node.nodeName}=${(node.textContent ?? '').trim()}`)
    .sort()
    .join(',');
}

/**
 * One machine's states and transitions as sorted lines, with its ids renumbered in order.
 *
 * Renumbering by the file's own id order means a state list written in a different order
 * still lines up, while names and positions go entirely. Used for the machine itself and,
 * separately, for each building block, so a block is described under the same rules rather
 * than under its own.
 */
function machineLines(states: XmlElement[], transitions: XmlElement[]): string[] {
  const ids = states
    .map((state) => state.getAttribute('id') ?? '')
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  const numbering = new Map(ids.map((id, index) => [id, index]));

  const stateLines = states
    .map((state) => {
      const id = numbering.get(state.getAttribute('id') ?? '') ?? -1;
      const initial = state.getElementsByTagName('initial').length > 0 ? 'i' : '';
      const final = state.getElementsByTagName('final').length > 0 ? 'f' : '';
      return `s${id}${initial}${final}`;
    })
    .sort();

  const transitionLines = transitions
    .map((transition) => {
      const from = numbering.get(childText(transition, 'from')) ?? -1;
      const to = numbering.get(childText(transition, 'to')) ?? -1;
      return `t${from}>${to}[${transitionLabel(transition)}]`;
    })
    .sort();

  return [...stateLines, ...transitionLines];
}

/**
 * Each Turing-machine building block as a little machine of its own, under its own name.
 *
 * A block's insides are deliberately left out of the lines above, where their ids would
 * collide with the machine's own. They still have to count for something: two machines with
 * the same top level and different work inside a block are two different machines, and
 * hashing them the same would report them as one machine drawn differently. Described under
 * the same rules as any other machine, so renumbering or reordering inside a block changes
 * nothing, and sorted, so the order the blocks were written in does not either.
 */
function blockShapeLines(doc: XmlDocument): string[] {
  return Array.from(doc.getElementsByTagName('block'))
    .flatMap((block) => {
      const name = (block.getAttribute('name') ?? '').trim();
      const inner = childrenNamed(block, 'automaton')[0];
      if (!inner) return [`b:${name}`];

      return machineLines(
        childrenNamed(inner, 'state'),
        childrenNamed(inner, 'transition'),
      ).map((line) => `b:${name}:${line}`);
    })
    .sort();
}

/** A grammar with its productions in a fixed order, so reordering them changes nothing. */
function shapeOfGrammar(doc: XmlDocument): string | null {
  const productions = Array.from(doc.getElementsByTagName('production'));
  if (productions.length === 0) return null;

  const lines = productions
    .map((production) => {
      const left = (production.getElementsByTagName('left').item(0)?.textContent ?? '').trim();
      const right = (production.getElementsByTagName('right').item(0)?.textContent ?? '').trim();
      return `${left}->${right}`;
    })
    .sort();

  // Duplicated productions are the same grammar written twice; collapse them.
  return ['grammar', ...new Set(lines)].join('|');
}

/**
 * The shape fingerprint: null when there is nothing layout-independent to say about the
 * file, which is the case for a regular expression (it is already only its text) and for
 * anything this cannot parse.
 */
export function submissionShapeHash(content: Buffer | string): string | null {
  const text = typeof content === 'string' ? content : content.toString('utf8');
  if (!text.includes('<structure')) return null;

  try {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const shape = shapeOfAutomaton(doc) ?? shapeOfGrammar(doc);
    if (!shape) return null;
    return createHash('sha256').update(shape, 'utf8').digest('hex');
  } catch {
    return null;
  }
}

/**
 * sha256 of the file exactly as it arrived, with nothing normalised away.
 *
 * The other two fingerprints deliberately look past the incidental: formatting for one,
 * layout and names for the other. That is what makes them useful, and it is also why
 * neither can say "these are the same file" without a qualifier. This one can. Two
 * submissions sharing it are the same bytes: same trailing newline, same line endings,
 * same JFLAP comment header, same everything.
 *
 * It is never a way to FIND a match. Identical bytes normalise to an identical
 * `contentHash`, so byte-equal work is already grouped by the checks above; this only
 * sharpens what can be said about a group that exists. Null for an empty file, which has
 * nothing to compare. Unlike the other two there is no trimming rule: a file that is only
 * whitespace is still a file somebody sent.
 */
export function submissionByteHash(content: Buffer | string): string | null {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  if (buffer.length === 0) return null;

  return createHash('sha256').update(buffer).digest('hex');
}
