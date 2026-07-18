import { z } from 'zod';
import { dateTimeLocalString } from './fields';

/** Datetime-local form field (shared with the course form). */
const DateTimeLocalForm = dateTimeLocalString;

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
    unlockAt?: string;
  },
  ctx: z.RefinementCtx,
) => {
  const allowLate = data.allowLateSubmissions ?? false;
  const dueRaw = data.dueDate;
  const cutoffRaw = data.lateCutoff;

  if (!dueRaw) return;
  const dueDate = new Date(dueRaw);

  if (data.unlockAt && new Date(data.unlockAt) > dueDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['unlockAt'],
      message: 'Available-from must be on or before the due date.',
    });
  }

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
    title: z
      .string()
      .trim()
      .min(3, 'Title must be at least 3 characters.')
      .max(200, 'Title is too long.'),
    description: z.string().trim().max(20000, 'Description is too long.').optional(),
    dueDate: DateTimeLocalForm,
    unlockAt: DateTimeLocalFormOptional,
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
    if (data.unlockAt && data.dueDate && new Date(data.unlockAt) > new Date(data.dueDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unlockAt'],
        message: 'Available-from must be on or before the due date.',
      });
    }

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

/**
 * Server (API) schemas for the assignment create/update routes. Dates stay as
 * strings (parsed in the course timezone server-side); field rules mirror the
 * routes they replaced. Distinct from the `*Form` schemas above.
 */
export const AssignmentCreateApiSchema = z.object({
  title: z.string().min(1, 'Missing required fields').max(200, 'Title is too long.'),
  description: z.string().max(20000, 'Description is too long.').optional(),
  dueDate: z.string().min(1, 'A due date is required.'),
  unlockAt: z.string().optional(),
  allowLateSubmissions: z.boolean().optional(),
  lateCutoff: z.string().optional(),
  isPublished: z.boolean().optional(),
  isGroup: z.boolean().optional(),
});

export const AssignmentUpdateApiSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  unlockAt: z.string().nullable().optional(),
  allowLateSubmissions: z.boolean().optional(),
  lateCutoff: z.string().nullable().optional(),
  isPublished: z.boolean().optional(),
  isGroup: z.boolean().optional(),
});

/** Types */
export type UpdateAssignmentInput = z.infer<typeof UpdateAssignmentSchema>;
export type AssignmentFormInput = z.infer<typeof AssignmentFormSchema>;
