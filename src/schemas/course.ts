import { z } from 'zod';

/**
 * Course code examples: CMPSC 221, MATH220, EE 200A
 * - 2–8 letters
 * - Optional single space
 * - 1–4 digits
 * - Optional trailing letter
 */
const courseCodeRegex = /^[A-Z]{2,8}\s?\d{1,4}[A-Z]?$/;

/**
 * Accepts <input type="datetime-local"> value like "2025-08-15T09:30"
 * Validates and transforms to a Date (local -> actual Date instance).
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
 * Normalize helpers
 */
const normalizeCode = (v: string) => v.trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * Base schema for course fields used in forms.
 */
const BaseCourseSchema = z
  .object({
    name: z.string().trim().min(3, 'Course name must be at least 3 characters.'),
    code: z
      .string()
      .trim()
      .min(2, 'Course code is required.')
      .transform(normalizeCode)
      .refine((v) => courseCodeRegex.test(v), {
        message: 'Use a code like "CMPSC 221" or "MATH220".',
      }),
    semester: z.string().trim().min(1, 'Semester is required.'),
    credits: z.coerce.number().int('Credits must be an integer.').min(1).max(6),
    startDate: DateTimeLocal,
    endDate: DateTimeLocal,
  })
  .refine((d) => d.startDate <= d.endDate, {
    path: ['endDate'],
    message: 'End date/time must be on or after the start date/time.',
  })
  .strict();

/**
 * Create schema — includes publish+faculty selection.
 */
export const CreateCourseSchema = BaseCourseSchema.extend({
  isPublished: z.boolean().default(false),
  facultyIds: z.array(z.string()).default([]),
}).superRefine((d, ctx) => {
  if (d.isPublished && d.facultyIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['facultyIds'],
      message: 'Pick at least one faculty member if publishing now.',
    });
  }
});

/**
 * Update schema — partial create schema + id
 */
export const UpdateCourseSchema = CreateCourseSchema.partial().extend({
  id: z.string().min(1, 'Course id is required.'),
});

/**
 * Export form-only schema for use in Add/Edit forms.
 */
export const CourseFormSchema = BaseCourseSchema;

/** Types */
export type CreateCourseInput = z.infer<typeof CreateCourseSchema>;
export type UpdateCourseInput = z.infer<typeof UpdateCourseSchema>;
export type CourseFormInput = z.infer<typeof BaseCourseSchema>;
export type CourseFormInputRaw = z.input<typeof CourseFormSchema>; // raw input values
export type CourseFormParsed = z.output<typeof CourseFormSchema>; // parsed/normalized values
