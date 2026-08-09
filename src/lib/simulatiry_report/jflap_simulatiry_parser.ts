import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { JflapSimilarityData } from './types';

function extractCommentTagValue(xml: string, tagName: string): string | undefined {
  const regex = new RegExp(
    `<!--\\s*(?:<${tagName}>([^<]*)<\\/${tagName}>|${tagName}:\\s*([^<]*))\\s*-->`,
    'gi',
  );
  let match: RegExpExecArray | null;
  let value: string | undefined;

  while ((match = regex.exec(xml)) !== null) {
    value = (match[1] ?? match[2])?.trim();
  }

  return value;
}

function serializeStructureNode(xml: string): string | null {
  if (!xml) return null;

  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const structures = doc.getElementsByTagName('structure');

    if (!structures || structures.length === 0) {
      return null;
    }

    const structureNode = structures.item(0);
    if (!structureNode) return null;

    // 1. Serialize DOM node back to string using @xmldom
    let serializedXml = new XMLSerializer().serializeToString(structureNode);

    // 2. Convert standard CR/LF line breaks (\r\n or \r) into explicit '&#13;\n' entities
    // to match Java's literal entity output
    serializedXml = serializedXml.replace(/\r\n/g, '&#13;\n').replace(/\r/g, '&#13;');

    // 3. Trim outer leading/trailing whitespace
    return serializedXml.trim();
  } catch (ex) {
    return null;
  }
}

function hashStructureElement(xml: string): string | undefined {
  const serialized = serializeStructureNode(xml);
  console.log("SERIALIZED STRUCTURE NODE: [" + serialized + "]");
  if (!serialized) return undefined;

  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

export async function jflapSimilarityParser(filePath: string): Promise<JflapSimilarityData | null> {
  try {
    if (!filePath.toLowerCase().endsWith('.jff')) {
      throw new Error('Expected a file path ending with .jff extension');
    }

    const fileContents = await fs.readFile(filePath, 'utf8');
    if (!fileContents) {
      throw new Error('JFLAP file is empty.');
    }

    const lines = fileContents.trimEnd().split(/\r?\n/);
    const [secondLastLine, lastLine] = [lines[lines.length - 2] ?? '', lines[lines.length - 1] ?? ''];

    let fileHashEmail = extractCommentTagValue(secondLastLine, 'hashE');
    let fileHashData = extractCommentTagValue(lastLine, 'hashD');
    
    if (fileHashEmail === null && fileHashData === null) {
      fileHashEmail = extractCommentTagValue(lastLine, 'hashE');
      fileHashData = extractCommentTagValue(secondLastLine, 'hashD');
    }

    const calcHashData = hashStructureElement(fileContents);

    return { fileHashEmail, fileHashData, calcHashData };
  } catch (error) {
    console.error('Failed to read JFLAP file:', error);
    return null;
  }
}
