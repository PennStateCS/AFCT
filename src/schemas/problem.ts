import { z } from 'zod';

/** Keep in sync with your Prisma enum */
export const ProblemTypeEnum = z.enum(['FA', 'PDA', 'CFG', 'RE']);

/** Allowed upload types (adjust as needed) */
const allowedExt = ['txt', 'fa', 'pda', 'cfg', 're'];

const FileRequired = z
  .instanceof(File, { message: 'Answer file is required.' })
  .refine((f) => f.size > 0, 'Answer file is required.')
  .refine(
    (f) => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      return allowedExt.includes(ext);
    },
    { message: `Allowed: .${allowedExt.join(',.')}` },
  )
  // ~5MB default max — tweak if you like
  .refine((f) => f.size <= 5 * 1024 * 1024, 'File must be ≤ 5MB');

/**
 * Base (form) schema for add/edit Problem
 * - title: string
 * - description: optional string
 * - type: enum
 * - isUnlimited + maxStates: only relevant for FA/PDA
 * - isDeterministic: only relevant for FA (kept as boolean, ignored for others)
 * - courseId: string
 * - file: optional here (Create requires it, Update does not)
 */
const BaseProblemSchema = z
  .object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters.'),
    description: z.string().trim().max(20000).optional().or(z.literal('')),
    type: ProblemTypeEnum,
    isUnlimited: z.boolean().default(true),
    maxStates: z.union([z.coerce.number().int().min(1).max(1000), z.nan()]).optional(),
    isDeterministic: z.boolean().default(false),
    courseId: z.string().min(1, 'Course id is required.'),
    file: z.instanceof(File).optional(),
  })
  .superRefine((d, ctx) => {
    const isFAorPDA = d.type === 'FA' || d.type === 'PDA';

    if (isFAorPDA && !d.isUnlimited) {
      // when limited, maxStates must be provided and valid
      const ms = Number(d.maxStates);
      if (!Number.isFinite(ms) || ms < 1 || ms > 1000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxStates'],
          message: 'Enter a max between 1 and 1000.',
        });
      }
    }
  })
  .strict();

/** Form-only schema (used by dialogs). */
export const ProblemFormSchema = BaseProblemSchema;

/** CREATE: requires file and adds the same FA/PDA rules */
export const CreateProblemSchema = BaseProblemSchema.extend({
  file: FileRequired,
});

/** UPDATE: partial + id (file optional) */
export const UpdateProblemSchema = BaseProblemSchema.partial().extend({
  id: z.string().min(1, 'Problem id is required.'),
});

/** Types */
export type ProblemFormInput = z.infer<typeof ProblemFormSchema>;
export type ProblemFormRaw = z.input<typeof ProblemFormSchema>;
export type CreateProblemInput = z.infer<typeof CreateProblemSchema>;
export type CreateProblemRaw = z.input<typeof CreateProblemSchema>;
export type UpdateProblemInput = z.infer<typeof UpdateProblemSchema>;
