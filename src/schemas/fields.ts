// src/schemas/fields.ts
//
// Reusable field-level Zod primitives shared by the form schemas (client) and the
// API body schemas (server). Centralizing the constraints here means a rule like
// "title ≥ 3 chars" or the datetime-local format lives in exactly one place, so a
// form and its route can't drift apart.
import { z } from 'zod';

/** A required, trimmed id/string. */
export const nonEmptyId = (label = 'Id') =>
  z.string().trim().min(1, `${label} is required.`);

/**
 * A `<input type="datetime-local">` value like "2025-08-15T09:30". Not transformed
 * to a Date — the server parses it in the course's timezone, and the client keeps
 * it as a string for the input. Shared by the course and assignment form schemas.
 */
export const dateTimeLocalString = z
  .string()
  .min(1, 'This field is required.')
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use a valid date & time (YYYY-MM-DDTHH:MM).')
  .superRefine((val, ctx) => {
    if (Number.isNaN(new Date(val).getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid date/time.' });
    }
  });

/**
 * Multipart form fields arrive as strings, so a checkbox is the literal "true" /
 * "false". Coerce to a real boolean the way the routes' `formBool` helper does
 * (only "true" is true). Use in API schemas fed by {@link readFormData}.
 */
export const formBoolean = z.preprocess((v) => v === 'true' || v === true, z.boolean());

/**
 * Same, but tri-state: an absent field stays `undefined` (so a PATCH can tell
 * "leave unchanged" from "set false"), matching `formBoolOptional`.
 */
export const formBooleanOptional = z.preprocess(
  (v) => (v === undefined ? undefined : v === 'true' || v === true),
  z.boolean().optional(),
);

/**
 * An integer submitted as a multipart string. Empty / absent → `undefined` so the
 * caller can apply a default; otherwise coerced and range-checked.
 */
export const formIntOptional = (opts?: { min?: number; max?: number }) =>
  z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    (() => {
      let n = z.coerce.number().int();
      if (opts?.min !== undefined) n = n.min(opts.min);
      if (opts?.max !== undefined) n = n.max(opts.max);
      return n.optional();
    })(),
  );
