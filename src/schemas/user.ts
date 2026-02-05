// src/schemas/user.ts
import { z } from 'zod';

export const RoleEnum = z.enum(['ADMIN', 'FACULTY', 'TA', 'STUDENT']);
export const CourseRoleEnum = z.enum(['ADMIN', 'FACULTY', 'TA', 'STUDENT']);

export const StrongPassword = z
  .string()
  .min(8, 'At least 8 characters.')
  .refine((v) => /[A-Z]/.test(v), { message: 'One uppercase letter.' })
  .refine((v) => /[a-z]/.test(v), { message: 'One lowercase letter.' })
  .refine((v) => /\d/.test(v), { message: 'One number.' })
  .refine((v) => /[^A-Za-z0-9]/.test(v), { message: 'One special character.' });

const BaseUserSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.'),
  lastName: z.string().trim().min(1, 'Last name is required.'),
  email: z
    .string()
    .trim()
    .email('Enter a valid email.')
    .transform((v) => v.toLowerCase()),
  role: RoleEnum,
});

export const CreateUserSchema = BaseUserSchema.extend({
  password: StrongPassword,
  confirmPassword: z.string(),
  timezone: z.string().trim().optional(),
}).refine((d) => d.password === d.confirmPassword, {
  path: ['confirmPassword'],
  message: 'Passwords must match.',
});

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
  return z
    .any()
    .refine((f) => {
      if (f && typeof f === 'object' && 'size' in f && 'type' in f) {
        return f.size <= 5 * 1024 * 1024 && f.type.startsWith('image/');
      }
      return true; // Let server handle validation
    }, 'Avatar must be a valid image ≤ 5MB')
    .optional();
};

const ImageFileOptional = createImageFileSchema();

export const UpdateUserSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.').max(60, 'First name is too long.'),
  lastName: z.string().trim().min(1, 'Last name is required.').max(60, 'Last name is too long.'),
  role: RoleEnum,
  avatarFile: ImageFileOptional,
  deleteAvatar: z.boolean().default(false),
  inactive: z.boolean(),
  timezone: z.string().trim().optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type CreateUserRaw = z.input<typeof CreateUserSchema>;

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type UpdateUserRaw = z.input<typeof UpdateUserSchema>;
