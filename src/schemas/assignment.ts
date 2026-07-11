import { z } from 'zod';

/**
 * Form datetime validation for <input type="datetime-local"> values (no
 * transformation — the server parses these in the course's timezone).
 */
const DateTimeLocalForm = z
  .string()
  .min(1, 'This field is required.')
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use a valid date & time (YYYY-MM-DDTHH:MM).')
  .superRefine((val, ctx) => {
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid date/time.',
      });
    }
  });

const DateTimeLocalFormOptional = DateTimeLocalForm.or(z.literal(''))
  .optional()
  .transform((val) => {
    if (!val || val === '') return undefined;
    return val;
  });

const validateLateSubmissionStrings = (
  data: {
    allowLateSubmissions?: boolean;
    lateCutoff?: string;
    dueDate?: string;
  },
  ctx: z.RefinementCtx,
) => {
  const allowLate = data.allowLateSubmissions ?? false;
  const dueRaw = data.dueDate;
  const cutoffRaw = data.lateCutoff;

  if (!dueRaw) return;
  const dueDate = new Date(dueRaw);

  if (allowLate) {
    if (!cutoffRaw) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lateCutoff'],
        message: 'Provide a cutoff or disable late submissions.',
      });
      return;
    }
    const cutoffDate = new Date(cutoffRaw);
    if (cutoffDate < dueDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lateCutoff'],
        message: 'Cutoff must be on or after the due date.',
      });
    }
  } else if (cutoffRaw) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lateCutoff'],
      message: 'Remove the cutoff or enable late submissions.',
    });
  }
};

/**
 * Base object schema for assignment forms (no date transformation).
 */
const BaseAssignmentFormSchemaObject = z
  .object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters.'),
    description: z
      .string()
      .trim()
      .max(20000, 'Description is too long.')
      .optional()
      .or(z.literal('')),
    dueDate: DateTimeLocalForm,
    allowLateSubmissions: z.boolean().default(false),
    lateCutoff: DateTimeLocalFormOptional,
    isPublished: z.boolean(),
    isGroup: z.boolean().optional(),
    courseId: z.string().min(1, 'Course id is required.'),
  })
  .strict();

/**
 * CREATE FORM: includes publish flag and rule: if publishing, maxPoints > 0.
 * Uses form-only date validation (no transformation)
 */
const AssignmentFormSchemaWithValidation = BaseAssignmentFormSchemaObject.superRefine(
  validateLateSubmissionStrings,
);

export const CreateAssignmentFormSchema = AssignmentFormSchemaWithValidation;

/**
 * UPDATE: partial base schema + id + optional isPublished with validation.
 */
export const UpdateAssignmentSchema = BaseAssignmentFormSchemaObject.partial()
  .extend({
    id: z.string().min(1, 'Assignment id is required.'),
    isPublished: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.allowLateSubmissions === undefined &&
      data.lateCutoff === undefined &&
      data.dueDate === undefined
    ) {
      return;
    }

    const allowLate = data.allowLateSubmissions ?? false;
    const dueRaw = data.dueDate;
    const cutoffRaw = data.lateCutoff;

    if (!allowLate && !cutoffRaw) {
      return;
    }

    if (allowLate && !cutoffRaw) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lateCutoff'],
        message: 'Provide a cutoff or disable late submissions.',
      });
      return;
    }

    if (!dueRaw || !cutoffRaw) return;

    const dueDate = new Date(dueRaw);
    const cutoffDate = new Date(cutoffRaw);

    if (allowLate && cutoffDate < dueDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lateCutoff'],
        message: 'Cutoff must be on or after the due date.',
      });
    }

    if (!allowLate && cutoffRaw) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lateCutoff'],
        message: 'Remove the cutoff or enable late submissions.',
      });
    }
  });

/** Export a form-only schema for UI, if you want the bare form without publish logic */
export const AssignmentFormSchema = AssignmentFormSchemaWithValidation;

/** Types */
export type UpdateAssignmentInput = z.infer<typeof UpdateAssignmentSchema>;
export type AssignmentFormInput = z.infer<typeof AssignmentFormSchema>;
