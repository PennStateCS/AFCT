import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { XMLParser } from 'fast-xml-parser';

export interface JflapSimilarityData {
  fileHashEmail: string | undefined;
  fileHashData: string | undefined;
  calcHash: string;
}

// Shape of the parsed JFLAP file before the appended hash comments.
interface ParsedJflapFile {
  structure?: unknown;
}

function extractCommentTagValue(line: string, tagName: string): string | undefined {
  const regex = new RegExp(`^\s*<!--\s*<${tagName}>([^<]*)<\/${tagName}>\s*-->\s*$`);
  const match = line.match(regex);
  return match?.[1]?.trim();
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

    const parser = new XMLParser();
    const parsed = parser.parse(fileContents) as ParsedJflapFile;

    const lines = fileContents.trimEnd().split(/\r?\n/);
    const fileHashEmail = extractCommentTagValue(lines[lines.length - 2] ?? '', 'hashE');
    const fileHashData = extractCommentTagValue(lines[lines.length - 1] ?? '', 'hashD');

    const calcHash = createHash('sha256')
      .update(JSON.stringify(parsed.structure))
      .digest('hex');

    return { fileHashEmail, fileHashData, calcHash };
  } catch (error) {
    console.error('Failed to read JFLAP file:', error);
    return null;
  }
}
