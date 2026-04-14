import { XMLValidator, XMLParser } from 'fast-xml-parser';

export type StructureValidationResult = { isValid: true } | { isValid: false; error: string };

export function validateStructureXML(fileInput: string, type: string | null): StructureValidationResult {
  const parser = new XMLParser();

  const isValidXml = XMLValidator.validate(fileInput);

  if (isValidXml !== true) {
    return { isValid: false, error: 'Solution file is not in valid XML format' };
  }

  const jff = parser.parse(fileInput);
  const expectedType = type === 'CFG' ? 'GRAMMAR' : type === 'TM' ? 'TURING' : type;

  if (!jff.structure || jff.structure.type.toUpperCase() !== expectedType) {
    return { isValid: false, error: `Solution file should be of type ${type}` };
  }

  return { isValid: true };
}