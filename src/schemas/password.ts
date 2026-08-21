// src/schemas/password.ts
import { z } from 'zod';
import { StrongPassword } from '@/schemas/user';

export const ChangePasswordSchema = z
  .object({
    oldPassword: z.string().min(1, 'Old password is required.'),
    // Reuse the shared strength schema so the change-password form enforces the
    // exact same rules (and length cap) as signup / admin-create.
    newPassword: StrongPassword,
    confirmNewPassword: z.string().min(1, 'Please confirm your new password.'),
  })
  .refine((d) => d.newPassword === d.confirmNewPassword, {
    path: ['confirmNewPassword'],
    message: 'Passwords do not match.',
  })
  .refine((d) => d.newPassword !== d.oldPassword, {
    path: ['newPassword'],
    message: 'New password must be different from old password.',
  });

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

/**
 * Setting a first password, on an account that has none.
 *
 * Same strength rules, no current password: there is not one to give. Kept separate from
 * {@link ChangePasswordSchema} rather than making its `oldPassword` optional, so neither form
 * can accidentally accept the other's shape.
 */
export const SetPasswordSchema = z
  .object({
    newPassword: StrongPassword,
    confirmNewPassword: z.string().min(1, 'Please confirm your new password.'),
  })
  .refine((d) => d.newPassword === d.confirmNewPassword, {
    path: ['confirmNewPassword'],
    message: 'Passwords do not match.',
  });

export type SetPasswordInput = z.infer<typeof SetPasswordSchema>;

/**
 * An admin setting another user's password (ResetPasswordDialog). Unlike
 * {@link ChangePasswordSchema} there's no old password to verify, just a strong
 * new password confirmed twice.
 */
export const ResetPasswordSchema = z
  .object({
    newPassword: StrongPassword,
    confirmNewPassword: z.string().min(1, 'Please confirm the new password.'),
  })
  .refine((d) => d.newPassword === d.confirmNewPassword, {
    path: ['confirmNewPassword'],
    message: "Passwords don't match",
  });

export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

/**
 * Asking for a reset link. Only an address, because that is all the endpoint is willing to
 * learn: the response is identical whether or not it belongs to an account.
 */
export const RequestPasswordResetSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(255),
});

export type RequestPasswordResetInput = z.infer<typeof RequestPasswordResetSchema>;

/** Following the link and choosing a new password. Same strength rules as everywhere else. */
export const CompletePasswordResetSchema = z
  .object({
    token: z.string().min(1),
    newPassword: StrongPassword,
    confirmNewPassword: z.string().min(1, 'Please confirm your new password.'),
  })
  .refine((d) => d.newPassword === d.confirmNewPassword, {
    path: ['confirmNewPassword'],
    message: 'Passwords do not match.',
  });

export type CompletePasswordResetInput = z.infer<typeof CompletePasswordResetSchema>;
