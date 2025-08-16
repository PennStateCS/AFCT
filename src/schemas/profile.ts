// src/schemas/profile.ts
import { z } from 'zod';

export const UpdateProfileSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(1, 'First name is required.')
      .max(60, 'First name is too long.'),
    lastName: z.string().trim().min(1, 'Last name is required.').max(60, 'Last name is too long.'),
    // Email is read-only in the dialog; we don't validate it here.
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
