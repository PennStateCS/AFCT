// src/schemas/client.ts
//
// Request schemas for the native-client API (`/api/client/v1/*`).
import { z } from 'zod';
import { isValidEmail } from '@/lib/email';

/**
 * Client login body. Unlike signup this does not enforce the strength policy; it
 * verifies an existing password, so `password` only needs to be present.
 */
export const ClientLoginSchema = z.object({
  email: z
    .string()
    .trim()
    .refine(isValidEmail, 'Enter a valid email address.')
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1, 'Password is required.'),
  deviceName: z.string().trim().max(100, 'Device name is too long.').optional(),
});

/**
 * Issuing a token from the account page. Only a label, which is there so a person can tell
 * "my laptop" from "the lab machine" when deciding which one to revoke.
 */
export const IssueClientTokenSchema = z.object({
  label: z.string().trim().max(60).optional(),
});

export type IssueClientTokenInput = z.infer<typeof IssueClientTokenSchema>;
