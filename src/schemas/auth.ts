// src/schemas/auth.ts
//
// Validation for self-service account registration, shared by the signup form
// (client) and POST /api/auth/signup (server). The four account fields live in
// `SignupFields` so both the request payload and the richer client form (which
// adds a confirm-password field) validate them identically.
import { z } from 'zod';
import { isValidEmail } from '@/lib/email';
import { StrongPassword } from '@/schemas/user';

const SignupFields = {
  firstName: z.string().trim().min(1, 'First name is required.'),
  lastName: z.string().trim().min(1, 'Last name is required.'),
  // Permissive `isValidEmail` (a single `@` + dotted domain) to match the rest of
  // the app rather than Zod's stricter `.email()`, then canonicalized to lowercase
  // so it matches `normalizeEmail` used everywhere else.
  email: z
    .string()
    .trim()
    .refine(isValidEmail, 'Enter a valid email address.')
    .transform((v) => v.toLowerCase()),
  password: StrongPassword,
} as const;

/**
 * The JSON body sent to POST /api/auth/signup. `interactionMs` and `captchaToken`
 * are anti-abuse signals; a non-numeric `interactionMs` falls back to undefined
 * (treated as "no signal") rather than rejecting the request.
 */
export const SignupSchema = z.object({
  ...SignupFields,
  interactionMs: z.number().finite().optional().catch(undefined),
  captchaToken: z.string().optional(),
});

/**
 * The login page's signup form: the account fields plus a confirm-password field
 * that must match. Used client-side to surface per-field errors before submitting.
 */
export const SignupFormSchema = z
  .object({
    ...SignupFields,
    confirmPassword: z.string().min(1, 'Confirm your password.'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: "Passwords don't match.",
  });

export type SignupInput = z.input<typeof SignupSchema>;
export type SignupPayload = z.output<typeof SignupSchema>;
export type SignupFormInput = z.input<typeof SignupFormSchema>;
