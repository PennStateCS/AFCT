import { boolean, z } from 'zod';

/**
 * Accepts <input type="datetime-local"> like "2025-08-15T23:59"
 * Validates and transforms to Date (local).
 */
const DateTimeLocal = z
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
  })
  .transform((val) => new Date(val));

/**
 * Form-only datetime validation (no transformation)
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

/**
 * Base (form) schema for add/edit.
 * Keep aligned with your Prisma model fields.
 */
const BaseAssignmentSchema = z
  .object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters.'),
    description: z
      .string()
      .trim()
      .max(20000, 'Description is too long.')
      .optional()
      .or(z.literal('')),
    dueDate: DateTimeLocal,
    courseId: z.string().min(1, 'Course id is required.'),
  })
  .strict();

/**
 * Form-only schema (no date transformation for forms)
 */
const BaseAssignmentFormSchema = z
  .object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters.'),
    description: z
      .string()
      .trim()
      .max(20000, 'Description is too long.')
      .optional()
      .or(z.literal('')),
    dueDate: DateTimeLocalForm,
    isPublished: z.boolean(),
    courseId: z.string().min(1, 'Course id is required.'),
  })
  .strict();

/**
 * CREATE: includes publish flag and rule: if publishing, maxPoints > 0.
 */
export const CreateAssignmentSchema = BaseAssignmentSchema.extend({
  isPublished: z.boolean().default(false),
});

/**
 * CREATE FORM: includes publish flag and rule: if publishing, maxPoints > 0.
 * Uses form-only date validation (no transformation)
 */
export const CreateAssignmentFormSchema = BaseAssignmentFormSchema.extend({
  isPublished: z.boolean(),
});

/**
 * UPDATE: partial base schema + id + optional isPublished with validation.
 */
export const UpdateAssignmentSchema = BaseAssignmentFormSchema.partial().extend({
  id: z.string().min(1, 'Assignment id is required.'),
  isPublished: z.boolean().optional(),
});

/** Export a form-only schema for UI, if you want the bare form without publish logic */
export const AssignmentFormSchema = BaseAssignmentFormSchema;

/** Types */
export type CreateAssignmentInput = z.infer<typeof CreateAssignmentSchema>;
export type UpdateAssignmentInput = z.infer<typeof UpdateAssignmentSchema>;
export type AssignmentFormInput = z.infer<typeof AssignmentFormSchema>;
export type AssignmentFormInputRaw = z.input<typeof CreateAssignmentSchema>; // strings for datetime-local
export type AssignmentFormParsed = z.output<typeof CreateAssignmentSchema>; // Dates, coerced numbers
