// Reading a JFLAP file's own states and transitions, and not somebody else's.
//
// A Turing machine can be built from blocks, and a `<block>` carries a whole automaton of
// its own: its own `<state>` elements, its own `<transition>` elements, and its own ids
// starting again at zero. `getElementsByTagName` returns every descendant, so asking the
// document for its states hands back the blocks' states mixed in with the machine's, under
// ids that collide with it. Anything built on that (a state count, the id topology, the
// geometry, the shape hash) then describes a machine that does not exist.
//
// One rule, in one place, because both the hashing and the provenance description need it
// and a subtle rule written twice drifts.

import type { Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom';

/** Direct children of one element, by tag. Nothing from further down the tree. */
export function childrenNamed(parent: XmlElement, tag: string): XmlElement[] {
  return Array.from(parent.childNodes ?? []).filter(
    (node): node is XmlElement => (node as XmlElement).nodeName === tag,
  );
}

function insideBlock(node: XmlElement): boolean {
  let parent = node.parentNode as XmlElement | null;
  while (parent) {
    if (parent.nodeName === 'block') return true;
    parent = parent.parentNode as XmlElement | null;
  }
  return false;
}

/**
 * The machine's own states or transitions: everything with that tag except what belongs to
 * a building block's inner automaton.
 *
 * A file with no blocks, which is nearly all of them, gets exactly what it got before.
 */
export function machineElements(doc: XmlDocument, tag: 'state' | 'transition'): XmlElement[] {
  return Array.from(doc.getElementsByTagName(tag)).filter((node) => !insideBlock(node));
}
