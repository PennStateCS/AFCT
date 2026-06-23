import { XMLValidator, XMLParser } from 'fast-xml-parser';

export type StructureValidationResult = { isValid: true } | { isValid: false; error: string };

export function validateStructureXML(fileInput: string, type: string | null): StructureValidationResult {
  const parser = new XMLParser();

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