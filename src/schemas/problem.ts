import { z } from 'zod';

/** Keep in sync with your Prisma enum */
export const ProblemTypeEnum = z.enum(['FA', 'PDA', 'CFG', 'RE']);

/** Allowed upload types (adjust as needed) */
const allowedExt = ['txt', 'fa', 'pda', 'cfg', 're', 'jff'];

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
 * Base object schema for add/edit Problem (without effects)
 */
const BaseProblemObject = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters.'),
  description: z.string().trim().max(20000).optional().or(z.literal('')),
  type: ProblemTypeEnum,
  isUnlimited: z.boolean().default(true),
  maxStates: z
    .union([z.coerce.number().int(), z.null()])
    .optional(),
  isDeterministic: z.boolean().default(false),
  courseId: z.string().min(1, 'Course id is required.'),
  file: z.instanceof(File).optional(),
}).strict();

/**
 * Add custom validation to the base object
 */
function addProblemValidation<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.superRefine((d, ctx) => {
    const isFAorPDA = d.type === 'FA' || d.type === 'PDA';

    if (isFAorPDA && !d.isUnlimited) {
      // Check if maxStates is required when unlimited is unchecked
      if (d.maxStates === null || d.maxStates === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxStates'],
          message: 'Max States is required when Unlimited is unchecked.',
        });
        return;
      }

      // Validate maxStates value based on isDeterministic
      const ms = Number(d.maxStates);
      if (!Number.isFinite(ms)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxStates'],
          message: 'Max States must be a valid number.',
        });
        return;
      }

      if (d.isDeterministic) {
        // When deterministic, allow -1 or values between 1-1000
        if (ms !== -1 && (ms < 1 || ms > 1000)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['maxStates'],
            message: 'For deterministic problems, Max States must be -1 or between 1 and 1000.',
          });
        }
      } else {
        // When non-deterministic, must be between 1-1000
        if (ms < 1 || ms > 1000) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['maxStates'],
            message: 'For non-deterministic problems, Max States must be between 1 and 1000.',
          });
        }
      }
    }
  });
}

/** Form-only schema (used by dialogs). */
export const ProblemFormSchema = addProblemValidation(BaseProblemObject);

/** Form schema with required file for creation dialogs */
export const CreateProblemFormSchema = addProblemValidation(
  BaseProblemObject.extend({
    file: FileRequired,
  })
);

/** CREATE: requires file and adds the same FA/PDA rules */
export const CreateProblemSchema = addProblemValidation(
  BaseProblemObject.extend({
    file: FileRequired,
  })
);

/** UPDATE: partial + id (file optional) */
export const UpdateProblemSchema = addProblemValidation(
  BaseProblemObject.partial().extend({
    id: z.string().min(1, 'Problem id is required.'),
  })
);

/** Types */
export type ProblemFormInput = z.infer<typeof ProblemFormSchema>;
export type ProblemFormRaw = z.input<typeof ProblemFormSchema>;
export type CreateProblemFormInput = z.infer<typeof CreateProblemFormSchema>;
export type CreateProblemFormRaw = z.input<typeof CreateProblemFormSchema>;
export type CreateProblemInput = z.infer<typeof CreateProblemSchema>;
export type CreateProblemRaw = z.input<typeof CreateProblemSchema>;
export type UpdateProblemInput = z.infer<typeof UpdateProblemSchema>;
