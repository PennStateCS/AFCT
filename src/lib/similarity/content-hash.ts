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
