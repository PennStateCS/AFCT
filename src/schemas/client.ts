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

/**
 * Redeeming a browser sign-in code for a bearer token. The verifier length bounds
 * are RFC 7636's (43-128); enforcing them here means a malformed client fails with
 * a 400 it can read rather than a generic refusal. The redirect URI is re-checked
 * against the one stored when the code was issued, so it is passed through as an
 * opaque string here rather than validated twice with two chances to disagree.
 */
/**
 * The browser sign-in request, as it arrives on the consent page's query string and
 * again as the approve form's hidden fields. Validated in both places with this one
 * schema, so the two cannot disagree about what a well-formed request is. The
 * redirect URI's loopback-only rule lives in lib/client-auth-codes, not here: it is
 * a security decision, not a shape.
 */
export const ClientAuthRequestSchema = z.object({
  redirect_uri: z.string().min(1).max(500),
  state: z.string().min(1).max(512),
  // An S256 challenge is base64url(sha256), always 43 characters.
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Malformed code challenge.'),
  code_challenge_method: z.literal('S256'),
  device_name: z.string().max(100).optional(),
});

export const ClientExchangeSchema = z.object({
  code: z.string().min(1, 'Code is required.').max(200),
  codeVerifier: z
    .string()
    .min(43, 'Code verifier is too short.')
    .max(128, 'Code verifier is too long.'),
  redirectUri: z.string().min(1, 'Redirect URI is required.').max(500),
});
