// src/schemas/profile.ts
import { z } from 'zod';

// Server-side safe image file validation
const createImageFileSchema = () => {
  // Check if File constructor is available (browser environment)
  if (typeof File !== 'undefined') {
    return z
      .instanceof(File, { message: 'Invalid file.' })
      .refine((f) => f.size <= 5 * 1024 * 1024, 'Avatar must be ≤ 5MB.')
      .refine((f) => f.type.startsWith('image/'), 'Avatar must be an image.')
      .optional();
  }
  
  // Server-side fallback
  return z.any().refine((f) => {
    if (f && typeof f === 'object' && 'size' in f && 'type' in f) {
      return f.size <= 5 * 1024 * 1024 && f.type.startsWith('image/');
    }
    return true; // Let server handle validation
  }, 'Avatar must be a valid image ≤ 5MB').optional();
};

const ImageFileOptional = createImageFileSchema();

export const UpdateProfileSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(1, 'First name is required.')
      .max(60, 'First name is too long.'),
    lastName: z.string().trim().min(1, 'Last name is required.').max(60, 'Last name is too long.'),
    // Email is read-only in the dialog; we don't validate it here.
    avatarFile: ImageFileOptional, // Optional file upload
    deleteAvatar: z.boolean().default(false), // Checkbox to delete avatar
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
