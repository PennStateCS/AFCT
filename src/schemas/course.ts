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
 * Form-only schema (no date transformation)
 */
const BaseCourseFormSchema = z
  .object({
    name: z.string().trim().min(3, 'Course name must be at least 3 characters.'),
    code: z.string().trim().min(2, 'Course code is required.'),
    semester: z.string().trim().min(1, 'Semester is required.'),
    credits: z.string().min(1, 'Credits are required.'),
    startDate: DateTimeLocalForm,
    endDate: DateTimeLocalForm,
  })
  .superRefine((d, ctx) => {
    // Validate course code format
    const normalizedCode = normalizeCode(d.code);
    if (!courseCodeRegex.test(normalizedCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['code'],
        message: 'Use a code like "CMPSC 221" or "MATH220".',
      });
    }

    // Validate credits
    const credits = Number(d.credits);
    if (isNaN(credits) || !Number.isInteger(credits) || credits < 1 || credits > 6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['credits'],
        message: 'Credits must be an integer between 1 and 6.',
      });
    }

    // Validate date range
    const startDate = new Date(d.startDate);
    const endDate = new Date(d.endDate);
    if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && startDate > endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'End date/time must be on or after the start date/time.',
      });
    }
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
 * Create form schema — includes publish+faculty selection.
 * Uses form-only validation (no transformations)
 */
export const CreateCourseFormSchema = BaseCourseFormSchema.extend({
  isPublished: z.boolean(),
  facultyIds: z.array(z.string()),
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
export const CourseFormSchema = BaseCourseFormSchema;

/** Types */
export type CreateCourseInput = z.infer<typeof CreateCourseSchema>;
export type UpdateCourseInput = z.infer<typeof UpdateCourseSchema>;
export type CourseFormInput = z.infer<typeof BaseCourseSchema>;
export type CourseFormInputRaw = z.input<typeof CourseFormSchema>; // raw input values
export type CourseFormParsed = z.output<typeof CourseFormSchema>; // parsed/normalized values
