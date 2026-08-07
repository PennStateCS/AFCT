import type { Prisma } from '@prisma/client';

/**
 * The three description columns, kept together on purpose.
 *
 * `description`, `descriptionFormat`, and `descriptionJson` are one value split across three
 * columns. Reading or sending a subset is always a bug, and it has already shipped twice: an
 * assignment serializer listed `description` by name and omitted `descriptionJson`, so the
 * staff table could only ever render plain text, and the course-update handler had the same
 * gap. Both were invisible because nothing tied the fields together.
 *
 * Import these helpers instead of naming the columns. A new read surface then gets the rich
 * document by construction rather than by someone remembering.
 */

/**
 * Prisma selection for the description columns.
 *
 * `satisfies` on each model rather than one shared object: the two models are structurally
 * identical today, but a shared constant typed against one of them would silently stop being
 * checked against the other if they ever diverge.
 */
export const assignmentDescriptionSelect = {
  description: true,
  descriptionFormat: true,
  descriptionJson: true,
} satisfies Prisma.AssignmentSelect;

export const problemDescriptionSelect = {
  description: true,
  descriptionFormat: true,
  descriptionJson: true,
} satisfies Prisma.ProblemSelect;

/**
 * The shape any record must have to be projected.
 *
 * Structural and permissive on purpose: it has to accept a Prisma row, a hand-written row type
 * from a route, and a test fixture without anyone reaching for a cast. `descriptionJson` is
 * `unknown` because that is what it honestly is until `parseRichDescriptionForRender` has run;
 * typing it as `Prisma.JsonValue` here would only invite an assertion at each call site.
 */
export type DescriptionColumns = {
  description?: string | null;
  descriptionFormat?: 'PLAIN_TEXT' | 'TIPTAP_JSON' | null;
  descriptionJson?: unknown;
};

/** What a response carries. Always all three, or all three masked. */
export type DescriptionProjection = {
  description: string | null;
  descriptionFormat: 'PLAIN_TEXT' | 'TIPTAP_JSON';
  descriptionJson: unknown;
};

/**
 * Project the description columns for a response, applying the content lock to ALL of them.
 *
 * `locked` is the single decision. Passing it here rather than masking fields individually is
 * the point: a locked assignment must not leak its prompt through the rich copy just because a
 * caller remembered `description` and forgot `descriptionJson`. When locked, the format is
 * reported as `PLAIN_TEXT` so a client cannot infer that a rich document exists.
 *
 * Note for legacy consumers: `/api/client/v1/*` and the other Java-client paths deliberately
 * send plain text only. Do NOT spread this into those responses; select `description` there and
 * keep the rich field out of the contract until it is coordinated with the RIT team.
 */
export function projectDescription(
  record: DescriptionColumns,
  { locked = false }: { locked?: boolean } = {},
): DescriptionProjection {
  if (locked) {
    return { description: null, descriptionFormat: 'PLAIN_TEXT', descriptionJson: null };
  }
  return {
    description: record.description ?? null,
    descriptionFormat: record.descriptionFormat ?? 'PLAIN_TEXT',
    descriptionJson: record.descriptionJson ?? null,
  };
}

/** The plain-text-only projection, for the clients that must not receive the rich document. */
export function projectPlainDescriptionOnly(
  record: DescriptionColumns,
  { locked = false }: { locked?: boolean } = {},
): { description: string | null } {
  return { description: locked ? null : (record.description ?? null) };
}
