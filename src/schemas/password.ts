// src/schemas/password.ts
import { z } from 'zod';

const hasUpper = /[A-Z]/;
const hasLower = /[a-z]/;
const hasDigit = /\d/;

export const ChangePasswordSchema = z
  .object({
    oldPassword: z.string().min(1, 'Old password is required.'),
    newPassword: z
      .string()
      .min(8, 'At least 8 characters.')
      .refine((v) => hasUpper.test(v), { message: 'Must contain an uppercase letter.' })
      .refine((v) => hasLower.test(v), { message: 'Must contain a lowercase letter.' })
      .refine((v) => hasDigit.test(v), { message: 'Must contain a number.' }),
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
