import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { XMLParser } from 'fast-xml-parser';

export interface JflapSimilarityData {
  fileUserId: string | undefined;
  fileHash: string | undefined;
  calcHash: string;
}

// Shape of the <data><one>/<two> block appended after <structure> in submitted .jff
// files, carrying the submitting user's id and a content hash used for similarity
// detection. Narrowed from the parser's `unknown` output before use below.
interface ParsedJflapFile {
  data?: {
    one?: unknown;
    two?: unknown;
  };
  structure?: unknown;
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

    const fileUserId: string | undefined = parsed.data?.one as string | undefined;
    const fileHash: string | undefined = parsed.data?.two as string | undefined;

    // Hash the parsed <structure> (excluding the appended <data> block) so it can be
    const calcHash = createHash('sha256').update(JSON.stringify(parsed.structure)).digest('hex');
    console.log(parsed.structure);

    return { fileUserId, fileHash, calcHash };
  } catch (error) {
    console.error('Failed to read JFLAP file:', error);
    return null;
  }
}
