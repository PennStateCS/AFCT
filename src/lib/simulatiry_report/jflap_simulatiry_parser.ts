import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
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

function canonicalizeXmlNode(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalizeXmlNode);
  }

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    normalized[key] = canonicalizeXmlNode((value as Record<string, unknown>)[key]);
  }
  return normalized;
}

function serializeStructureNode(xml: string): string | null {
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: false,
      parseTagValue: false,
      trimValues: true,
    });
    const parsed = parser.parse(xml) as Record<string, unknown>;
    const structure = parsed?.structure;

    if (!structure || typeof structure !== 'object') {
      return null;
    }

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: false,
      suppressEmptyNode: false,
    });

    return builder.build({ structure: canonicalizeXmlNode(structure) });
  } catch {
    return null;
  }
}

function hashStructureElement(xml: string): string | undefined {
  const serialized = serializeStructureNode(xml);
  if (!serialized) return undefined;

  return createHash('sha256').update(serialized).digest('hex');
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
    const fileHashEmail = extractCommentTagValue(secondLastLine, 'hashE');
    const fileHashData = extractCommentTagValue(lastLine, 'hashD');
    const calcHashData = hashStructureElement(fileContents);

    return { fileHashEmail, fileHashData, calcHashData };
  } catch (error) {
    console.error('Failed to read JFLAP file:', error);
    return null;
  }
}
