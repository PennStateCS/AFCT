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
 * An admin setting another user's password (AdminResetPasswordDialog). Unlike
 * {@link ChangePasswordSchema} there's no old password to verify, just a strong
 * new password confirmed twice.
 */
export const AdminResetPasswordSchema = z
  .object({
    newPassword: StrongPassword,
    confirmNewPassword: z.string().min(1, 'Please confirm the new password.'),
  })
  .refine((d) => d.newPassword === d.confirmNewPassword, {
    path: ['confirmNewPassword'],
    message: "Passwords don't match",
  });

export type AdminResetPasswordInput = z.infer<typeof AdminResetPasswordSchema>;
