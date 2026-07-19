import { z } from 'zod';
import { formBooleanOptional, formIntOptional } from './fields';

/** Keep in sync with your Prisma enum */
export const ProblemTypeEnum = z.enum(['FA', 'PDA', 'CFG', 'RE', 'TM']);

/**
 * Allowed solution-file extensions. Enforced by BOTH the client file field (below)
 * and the server routes (via {@link isAllowedProblemExtension}) so a non-browser
 * client can't upload an arbitrary file type.
 */
export const ALLOWED_PROBLEM_EXTENSIONS = ['txt', 'fa', 'pda', 'cfg', 're', 'jff'] as const;

/** True if `fileName`'s extension is in {@link ALLOWED_PROBLEM_EXTENSIONS}. */
export const isAllowedProblemExtension = (fileName: string): boolean => {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return (ALLOWED_PROBLEM_EXTENSIONS as readonly string[]).includes(ext);
};

// Required solution-file upload (used by the client CreateProblemSchema). `File`
// is a global in both the browser and Node 22, so no environment guard is needed.
const FileRequired = z
  .instanceof(File, { message: 'Answer file is required.' })
  .refine((f) => f.size > 0, 'Answer file is required.')
  .refine((f) => isAllowedProblemExtension(f.name), {
    message: `Allowed: .${ALLOWED_PROBLEM_EXTENSIONS.join(', .')}`,
  })
  .refine((f) => f.size <= 5 * 1024 * 1024, 'File must be ≤ 5MB');

/**
 * Base object schema for add/edit Problem (without effects)
 */
// The intrinsic problem definition only. maxPoints / maxSubmissions / autograderEnabled
// are per-assignment and live on AssignmentProblem (see ProblemAssociationSettingsSchema),
// so they are deliberately NOT part of the bank create/edit form.
const BaseProblemObject = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters.').max(200, 'Title is too long.'),
  description: z.string().trim().max(20000).optional(),
  type: ProblemTypeEnum,
  isUnlimitedStates: z.boolean().default(true),
  maxStates: z
    .union([z.coerce.number().int(), z.null()])
    .optional(),
  isDeterministic: z.boolean().default(false),
  courseId: z.string().min(1, 'Course id is required.'),
  file: typeof File !== 'undefined' ? z.instanceof(File).optional() : z.any().optional(),
}).strict();

/**
 * Add custom validation to the base object
 */
function addProblemValidation<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.superRefine((data, ctx) => {
    // The helper is generic over the raw shape, which Zod 4 types as an opaque
    // mapped type; every variant (base / +file / partial) shares these base
    // fields, so narrow to the known shape for the conditional checks.
    const d = data as Partial<z.infer<typeof BaseProblemObject>>;
    const isFAorPDA = d.type === 'FA' || d.type === 'PDA';

    if (isFAorPDA && !d.isUnlimitedStates) {
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

/**
 * Server-side validation for the problem create/update routes, which receive
 * multipart form data (all scalar fields arrive as strings). Fed by `readFormData`;
 * the File itself and the dynamic size limit / XML-structure check stay in the
 * route, but the extension allow-list is enforced there via
 * {@link isAllowedProblemExtension}. This is the server counterpart to the
 * client-only `ProblemFormSchema`; the browser was previously the only validator.
 */
const problemApiScalars = {
  title: z
    .string()
    .trim()
    .min(3, 'Title must be at least 3 characters.')
    .max(200, 'Title is too long.'),
  description: z.string().trim().max(20000, 'Description is too long.').optional(),
  type: ProblemTypeEnum,
  // Optional context for the activity log when a problem is created inside an assignment.
  assignmentId: z.string().trim().optional(),
  maxStates: formIntOptional(),
  isDeterministic: formBooleanOptional,
};

export const ProblemCreateApiSchema = z.object(problemApiScalars);
export const ProblemUpdateApiSchema = z.object(problemApiScalars);

export type ProblemCreateApiInput = z.infer<typeof ProblemCreateApiSchema>;

/**
 * Per-problem settings sent when associating an existing problem with an
 * assignment (AssociateProblemsDialog). `maxSubmissions === -1` means unlimited;
 * otherwise it must be an integer ≥ 1. `z.number()` accepts NaN by type, so the
 * refinements do the real bounds checking (and surface the dialog's messages).
 */
export const ProblemAssociationSettingsSchema = z.object({
  problemId: z.string().min(1, 'Selected problem is no longer available.'),
  maxPoints: z
    .number()
    .refine(
      (n) => Number.isFinite(n) && n >= 0,
      'Max points must be a number greater than or equal to 0.',
    ),
  maxSubmissions: z
    .number()
    .refine(
      (n) => n === -1 || (Number.isInteger(n) && n >= 1),
      'Max submissions must be unlimited or an integer greater than or equal to 1.',
    ),
  autograderEnabled: z.boolean(),
});

export const ProblemAssociationSettingsArray = z.array(ProblemAssociationSettingsSchema);

export type ProblemAssociationSettings = z.infer<typeof ProblemAssociationSettingsSchema>;

/**
 * Server body for updating one problem's per-assignment settings (the PUT on
 * .../assignments/[aid]/problems/[pid]). The problemId comes from the path, so
 * unlike {@link ProblemAssociationSettingsSchema} it isn't part of the body.
 */
export const AssignmentProblemSettingsSchema = z.object({
  maxPoints: z.number().min(0),
  maxSubmissions: z
    .number()
    .int()
    .refine((value) => value === -1 || value >= 1, {
      message: 'Max submissions must be unlimited (-1) or at least 1.',
    }),
  autograderEnabled: z.boolean(),
});

export type AssignmentProblemSettingsInput = z.infer<typeof AssignmentProblemSettingsSchema>;

/** Types */
export type ProblemFormInput = z.infer<typeof ProblemFormSchema>;
export type ProblemFormRaw = z.input<typeof ProblemFormSchema>;
export type CreateProblemInput = z.infer<typeof CreateProblemSchema>;
export type CreateProblemRaw = z.input<typeof CreateProblemSchema>;
export type UpdateProblemInput = z.infer<typeof UpdateProblemSchema>;
