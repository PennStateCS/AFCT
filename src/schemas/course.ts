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
/**
 * Base schema object without effects
 */
const BaseCourseObject = z
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
    registrationOpenAt: DateTimeLocal,
    registrationCloseAt: DateTimeLocal,
    isPublished: z.boolean().default(false),
  })
  .strict();

/**
 * Form-only base object schema (no date transformation)
 */
const BaseCourseFormObject = z
  .object({
    name: z.string().trim().min(3, 'Course name must be at least 3 characters.'),
    code: z.string().trim().min(2, 'Course code is required.'),
    semester: z.string().trim().min(1, 'Semester is required.'),
    credits: z.string().min(1, 'Credits are required.'),
    startDate: DateTimeLocalForm,
    endDate: DateTimeLocalForm,
    registrationOpenAt: DateTimeLocalForm,
    registrationCloseAt: DateTimeLocalForm,
  })
  .strict();

/**
 * Create schema — includes publish+instructor selection.
 */
export const CreateCourseSchema = BaseCourseObject.extend({
  //facultyIds: z.array(z.string()).default([]),
  instructorIds: z.array(z.string()).default([]),
})
  .refine((d) => d.startDate <= d.endDate, {
    path: ['startDate'],
    message: 'Start date/time must be on or before the end date/time.',
  })
  .refine((d) => d.startDate <= d.endDate, {
    path: ['endDate'],
    message: 'End date/time must be on or after the start date/time.',
  })
  .superRefine((d, ctx) => {
    if (d.instructorIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['instructorIds'],
        message: 'Pick at least one instructor.',
      });
    }
  });

/**
 * Create form schema — includes publish+instructor selection.
 * Uses form-only validation (no transformations)
 */
export const CreateCourseFormSchema = BaseCourseFormObject.extend({
  isPublished: z.boolean(),
  //facultyIds: z.array(z.string()),
  instructorIds: z.array(z.string()),
}).superRefine((d, ctx) => {
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
      path: ['startDate'],
      message: 'Start date/time must be on or before the end date/time.',
    });
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'End date/time must be on or after the start date/time.',
    });
  }

  if (d.instructorIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['instructorIds'],
      message: 'Pick at least one instructor.',
    });
  }

  const registrationOpenAt = new Date(d.registrationOpenAt);
  const registrationCloseAt = new Date(d.registrationCloseAt);

  if (registrationOpenAt > registrationCloseAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['registrationOpenAt'],
      message: 'Self registration open must be on or before the close date.',
    });
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['registrationCloseAt'],
      message: 'Self registration close must be on or after the open date.',
    });
  }
});

/**
 * Update schema — partial base object + id
 */
export const UpdateCourseSchema = BaseCourseObject.partial().extend({
  id: z.string().min(1, 'Course id is required.'),
  isArchived: z.boolean().default(false),
});

/**
 * Export form-only schema for use in Add/Edit forms.
 */
export const CourseFormSchema = BaseCourseFormObject.extend({
  isPublished: z.boolean().default(false),
  isArchived: z.boolean().default(false),
  instructorIds: z.array(z.string()).default([]),
})
  .refine((d) => d.startDate <= d.endDate, {
    path: ['startDate'],
    message: 'Start date/time must be on or before the end date/time.',
  })
  .refine((d) => d.startDate <= d.endDate, {
    path: ['endDate'],
    message: 'End date/time must be on or after the start date/time.',
  })
  .superRefine((d, ctx) => {
    const registrationOpenAt = new Date(d.registrationOpenAt);
    const registrationCloseAt = new Date(d.registrationCloseAt);

    if (registrationOpenAt > registrationCloseAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['registrationOpenAt'],
        message: 'Self registration open must be on or before the close date.',
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['registrationCloseAt'],
        message: 'Self registration close must be on or after the open date.',
      });
    }

    if (d.instructorIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['instructorIds'],
        message: 'Pick at least one faculty member.',
      });
    }
  });

/**
 * Export form-only schema for use in Duplicate forms.
 */
export const DuplicateFormSchema = BaseCourseFormObject.extend({
  copyMode: z.enum(['assignments', 'assignments_with_problems', 'problems']).optional(),
  copyFaculty: z.boolean().optional(),
  copyTAs: z.boolean().optional(),
})
  .refine((d) => d.startDate <= d.endDate, {
    path: ['startDate'],
    message: 'Start date/time must be on or before the end date/time.',
  })
  .refine((d) => d.startDate <= d.endDate, {
    path: ['endDate'],
    message: 'End date/time must be on or after the start date/time.',
  })
  .superRefine((d, ctx) => {
    const normalizedCode = normalizeCode(d.code);
    if (!courseCodeRegex.test(normalizedCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['code'],
        message: 'Use a code like "CMPSC 221" or "MATH220".',
      });
    }

    const credits = Number(d.credits);
    if (!Number.isInteger(credits) || credits < 1 || credits > 6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['credits'],
        message: 'Credits must be an integer between 1 and 6.',
      });
    }

    const registrationOpenAt = new Date(d.registrationOpenAt);
    const registrationCloseAt = new Date(d.registrationCloseAt);

    if (registrationOpenAt > registrationCloseAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['registrationOpenAt'],
        message: 'Self registration open must be on or before the close date.',
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['registrationCloseAt'],
        message: 'Self registration close must be on or after the open date.',
      });
    }
  });

/** Types */
export type CreateCourseInput = z.infer<typeof CreateCourseSchema>;
export type UpdateCourseInput = z.infer<typeof UpdateCourseSchema>;
export type CourseFormInput = z.infer<typeof CourseFormSchema>;
export type CourseFormInputRaw = z.input<typeof CourseFormSchema>; // raw input values
export type CourseFormParsed = z.output<typeof CourseFormSchema>; // parsed/normalized values
