import { XMLValidator, XMLParser } from 'fast-xml-parser';

export type StructureValidationResult = { isValid: true } | { isValid: false; error: string };

// A document type definition is never part of a legitimate JFLAP structure file, but the
// downstream evaluator parses uploads with an unhardened JAXP DocumentBuilder that resolves
// DOCTYPE/ENTITY declarations. A crafted DTD there is an XXE vector (server-side file read,
// answer-key disclosure, out-of-band exfiltration). Reject any upload declaring one before it
// is ever stored, so the evaluator only sees entity-free XML. Matches a DOCTYPE/ENTITY token
// anywhere, tolerating leading whitespace/comments and case.
const DOCTYPE_OR_ENTITY = /<!\s*(DOCTYPE|ENTITY)\b/i;

export function validateStructureXML(fileInput: string, type: string | null): StructureValidationResult {
  const parser = new XMLParser();

  if (DOCTYPE_OR_ENTITY.test(fileInput)) {
    return { isValid: false, error: 'Solution file must not contain a DOCTYPE or ENTITY declaration' };
  }

  const xmlResult = XMLValidator.validate(fileInput);

  if (xmlResult !== true) {
    const detail =
      typeof xmlResult === 'object' && xmlResult.err?.msg
        ? `: ${xmlResult.err.msg} (line ${xmlResult.err.line})`
        : '';
    return { isValid: false, error: `Solution file is not valid XML${detail}` };
  }

  const jff = parser.parse(fileInput);
  const expectedType = type === 'CFG' ? 'GRAMMAR' : type === 'TM' ? 'TURING' : type;

  if (!jff.structure || String(jff.structure.type).toUpperCase() !== expectedType) {
    return { isValid: false, error: `Solution file should be of type ${type}` };
  }

  return { isValid: true };
}