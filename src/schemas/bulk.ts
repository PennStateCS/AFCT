// src/schemas/bulk.ts
//
// Shared request/validation schemas for the bulk operations, so the dialogs that
// build these payloads and the routes that consume them agree on one definition.
//   - Bulk enroll:  BulkEnrollDialog  ↔  lookup-users + roster/bulk routes
//   - Bulk import:  ImportUsersDialog ↔  admin/users/bulk route
import { z } from 'zod';
import { isValidEmail } from '@/lib/email';
import { StrongPassword } from '@/schemas/user';

/** Emails pasted into the enroll dialog, resolved to accounts by lookup-users. */
export const BulkEnrollEmailsSchema = z.object({
  emails: z.array(z.string()).default([]),
});

/** The resolved account ids the enroll dialog submits to roster/bulk. */
export const BulkEnrollUserIdsSchema = z.object({
  userIds: z.array(z.string()).default([]),
});

/**
 * The bulk import envelope. `rows` stay loose (`z.unknown`) on purpose: the route
 * validates each row independently and reports per-row failures rather than
 * rejecting the whole batch, so a single malformed row must not fail the request.
 */
export const BulkImportUsersSchema = z.object({
  rows: z.array(z.unknown()).default([]),
  temporaryPasswords: z.boolean().optional(),
});

/**
 * Strict shape of a single import row, used *client-side* to pre-flag rows that
 * the server would reject: the same rules the route applies per row (non-empty
 * name, valid email, strong password). Not used to gate the request.
 */
export const BulkImportRowSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim().refine(isValidEmail),
  password: StrongPassword,
});

export type BulkImportUsersPayload = z.infer<typeof BulkImportUsersSchema>;
