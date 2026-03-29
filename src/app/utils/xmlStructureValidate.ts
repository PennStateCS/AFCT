import { showToast } from '@/lib/toast';
import { XMLValidator, XMLParser } from 'fast-xml-parser';

export type StructureValidationResult = { isValid: true } | { isValid: false; error: string };

export function validateStructureXML(fileInput: string, type: string | null): StructureValidationResult {
  const parser = new XMLParser();

  const isValidXml = XMLValidator.validate(fileInput);

  if (isValidXml !== true) {
    const err = 'Solution file is not in valid XML format';
    showToast.error(err);
    return { isValid: false, error: err };
  }

  const jff = parser.parse(fileInput);

  if (!jff.structure || jff.structure.type.toUpperCase() !== (type === 'CFG' ? 'GRAMMAR' : type)) {
    const err = `Solution file should be of type ${type}`;
    showToast.error(err);
    return { isValid: false, error: err };
  }

  return { isValid: true };
}