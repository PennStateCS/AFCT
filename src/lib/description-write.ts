import { Prisma } from '@prisma/client';
import { buildDescriptionWrite, type DescriptionWriteInput } from '@/lib/rich-description';

/**
 * Prisma-ready mapping of the rich-description write helpers. Keeps `Prisma.DbNull` out of the
 * pure `@/lib/rich-description` layer while giving every assignment/problem write path one place
 * to compute the `description` / `descriptionFormat` / `descriptionJson` trio.
 */

export type PrismaDescriptionFields = {
  description: string | null;
  descriptionFormat: 'PLAIN_TEXT' | 'TIPTAP_JSON';
  descriptionJson: Prisma.InputJsonValue | typeof Prisma.DbNull;
};

/** Compute the description columns for a create or full update from a validated request input. */
export function descriptionWriteData(input: DescriptionWriteInput): PrismaDescriptionFields {
  const fields = buildDescriptionWrite(input);
  return {
    description: fields.description,
    descriptionFormat: fields.descriptionFormat,
    descriptionJson:
      fields.descriptionJson === null ? Prisma.DbNull : (fields.descriptionJson as unknown as Prisma.InputJsonValue),
  };
}

/** Copy the description columns verbatim from a source row (duplication / import copies). */
export function descriptionCopyData(source: {
  description: string | null;
  descriptionFormat: 'PLAIN_TEXT' | 'TIPTAP_JSON';
  descriptionJson: Prisma.JsonValue | null;
}): PrismaDescriptionFields {
  return {
    description: source.description,
    descriptionFormat: source.descriptionFormat,
    descriptionJson:
      source.descriptionJson == null ? Prisma.DbNull : (source.descriptionJson as Prisma.InputJsonValue),
  };
}
