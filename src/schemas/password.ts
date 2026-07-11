// src/schemas/password.ts
import { z } from 'zod';
import { StrongPassword } from '@/schemas/user';

const hasUpper = /[A-Z]/;
const hasLower = /[a-z]/;
const hasDigit = /\d/;
const hasSpecial = /[^A-Za-z0-9]/;

export const ChangePasswordSchema = z
  .object({
    oldPassword: z.string().min(1, 'Old password is required.'),
    newPassword: z
      .string()
      .min(8, 'At least 8 characters.')
      .refine((v) => hasUpper.test(v), { message: 'Must contain an uppercase letter.' })
      .refine((v) => hasLower.test(v), { message: 'Must contain a lowercase letter.' })
      .refine((v) => hasDigit.test(v), { message: 'Must contain a number.' })
      .refine((v) => hasSpecial.test(v), { message: 'Must contain a special character.' }),
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
 * {@link ChangePasswordSchema} there's no old password to verify — just a strong
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
