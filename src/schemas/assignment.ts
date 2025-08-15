import { z } from 'zod';

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
    maxPoints: z.coerce
      .number({ invalid_type_error: 'Max points are required.' })
      .min(0, 'Max points cannot be negative.')
      .max(100000, 'Max points is too large.'),
    dueDate: DateTimeLocal,
    courseId: z.string().min(1, 'Course id is required.'),
  })
  .strict();

/**
 * CREATE: includes publish flag and rule: if publishing, maxPoints > 0.
 */
export const CreateAssignmentSchema = BaseAssignmentSchema.extend({
  isPublished: z.boolean().default(false),
}).superRefine((d, ctx) => {
  if (d.isPublished && d.maxPoints <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxPoints'],
      message: 'Max points must be greater than 0 to publish.',
    });
  }
});

/**
 * UPDATE: partial create schema + id.
 */
export const UpdateAssignmentSchema = CreateAssignmentSchema.partial().extend({
  id: z.string().min(1, 'Assignment id is required.'),
});

/** Export a form-only schema for UI, if you want the bare form without publish logic */
export const AssignmentFormSchema = BaseAssignmentSchema;

/** Types */
export type CreateAssignmentInput = z.infer<typeof CreateAssignmentSchema>;
export type UpdateAssignmentInput = z.infer<typeof UpdateAssignmentSchema>;
export type AssignmentFormInput = z.infer<typeof AssignmentFormSchema>;
export type AssignmentFormInputRaw = z.input<typeof CreateAssignmentSchema>; // strings for datetime-local
export type AssignmentFormParsed = z.output<typeof CreateAssignmentSchema>; // Dates, coerced numbers
