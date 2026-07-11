// src/schemas/grade.ts
//
// Shared validation for the batch problem-grades save, used by the
// GradeBreakdownDialog (client) and the problem-grades route (server).
import { z } from 'zod';

/**
 * The batch save envelope: a map of problemId → grade (a number, or null to
 * clear). The route re-checks each value against that problem's maxPoints and
 * that the problem belongs to the assignment; those bounds are data-dependent so
 * they live in the handler, not here.
 */
export const BatchProblemGradesSchema = z.object({
  grades: z.record(z.string(), z.number().nullable()),
});

export type BatchProblemGrades = z.infer<typeof BatchProblemGradesSchema>;

/**
 * A single grade cell: null (clear) or a finite number within [0, maxPoints].
 * Built per problem so the dialog can validate each edited grade against that
 * problem's own maximum before submitting (`z.number()` accepts NaN by type, so
 * the `Number.isFinite` guard rejects unparseable input that would otherwise be
 * serialized to null).
 */
export const gradeCellSchema = (maxPoints: number) =>
  z
    .union([z.null(), z.number()])
    .refine(
      (n) => n === null || (Number.isFinite(n) && n >= 0 && n <= maxPoints),
      `Grade must be a number between 0 and ${maxPoints}.`,
    );
