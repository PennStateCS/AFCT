/**
 * Writing a JFLAP `.jff` file back out.
 *
 * The counterpart to `parseJflap`, and it exists so the viewer can hand back the machine as
 * it currently sits, which after auto-arranging is usually far more readable than the file
 * that arrived. The original is never modified: this always produces a new file.
 *
 * Everything emitted here was taken from the same sources as the parser, which read the
 * evaluator's own `file/xml/AutomatonTransducer` and was checked against files JFLAP 7.1
 * saved. Two consequences worth keeping in mind when changing it:
 *
 * - Epsilon is an EMPTY element (`<read/>`), not the epsilon character. Writing the symbol
 *   would produce a machine that reads a literal epsilon.
 * - A real line break inside a note is a CRLF. A bare `\n` is not a break to JFLAP, and
 *   `&#13;` is not one either: it joins the words instead.
 *
 * The guarantee to hold on to is the round trip. Parsing what this writes must give back
 * what it was given, which is what its test asserts over every fixture.
 */

import type { MachineType, Parsed } from '@/lib/jflap-parse';

/** What JFLAP writes in `<type>` for each machine. */
const TYPE_TAG: Record<MachineType, string> = {
  fa: 'fa',
  pda: 'pda',
  tm: 'turing',
  // Nothing sensible to claim, and 'fa' would be a lie that JFLAP would act on. A file with
  // no type still parses back to 'unknown', so the round trip holds.
  unknown: '',
};

/** XML text, with the five characters that cannot appear raw. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Coordinates as JFLAP writes them: floats, one decimal place.
 *
 * Not integers. JFLAP reads either, but a file full of `120` where it writes `120.0` is the
 * kind of difference that makes two files look unlike each other for no reason.
 */
function coord(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0';
}

/**
 * The transition fields that belong to a machine of this type.
 *
 * A finite automaton has only `read`; a pushdown automaton pops and pushes; a Turing machine
 * writes and moves. Emitting the others would not break JFLAP, but it would put fields in a
 * file that the machine has no meaning for.
 */
function transitionFields(
  type: MachineType,
): readonly ('read' | 'write' | 'move' | 'pop' | 'push')[] {
  if (type === 'pda') return ['read', 'pop', 'push'];
  if (type === 'tm') return ['read', 'write', 'move'];
  return ['read'];
}

export function toJflapXml(parsed: Parsed): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8" standalone="no"?>', '<structure>'];

  const typeTag = TYPE_TAG[parsed.type];
  if (typeTag) lines.push(`\t<type>${typeTag}</type>`);
  lines.push('\t<automaton>');

  for (const state of parsed.states) {
    lines.push(`\t\t<state id="${escapeXml(state.id)}" name="${escapeXml(state.name)}">`);
    lines.push(`\t\t\t<x>${coord(state.xPos)}</x>`);
    lines.push(`\t\t\t<y>${coord(state.yPos)}</y>`);
    // Empty elements, exactly as JFLAP writes them: their presence is the flag.
    if (state.initial) lines.push('\t\t\t<initial/>');
    if (state.final) lines.push('\t\t\t<final/>');
    lines.push('\t\t</state>');
  }

  // Written in the order the file declared them, which `__idx` preserves through parsing, so
  // a round trip does not quietly reorder somebody's machine.
  const ordered = [...parsed.transitions].sort((a, b) => a.__idx - b.__idx);
  for (const transition of ordered) {
    lines.push('\t\t<transition>');
    lines.push(`\t\t\t<from>${escapeXml(transition.from)}</from>`);
    lines.push(`\t\t\t<to>${escapeXml(transition.to)}</to>`);
    for (const field of transitionFields(parsed.type)) {
      const value = transition[field] ?? '';
      // An empty element means epsilon, or the blank tape symbol. Never the symbol itself.
      lines.push(
        value === '' ? `\t\t\t<${field}/>` : `\t\t\t<${field}>${escapeXml(value)}</${field}>`,
      );
    }
    lines.push('\t\t</transition>');
  }

  for (const note of parsed.notes) {
    // CRLF, because that is the only thing JFLAP treats as a line break inside a note.
    const text = escapeXml(note.text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
    lines.push('\t\t<note>');
    lines.push(`\t\t\t<text>${text}</text>`);
    lines.push(`\t\t\t<x>${coord(note.xPos)}</x>`);
    lines.push(`\t\t\t<y>${coord(note.yPos)}</y>`);
    lines.push('\t\t</note>');
  }

  lines.push('\t</automaton>', '</structure>', '');
  return lines.join('\n');
}
