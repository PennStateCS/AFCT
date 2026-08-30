// src/schemas/profile.ts
import { z } from 'zod';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import { formBoolean } from './fields';
import { ImageFileOptional } from './image-file';

/**
 * Server body for the profile update route (POST /api/me, multipart). Validates
 * the scalar fields via `readFormData`; the avatar File and the dynamic upload-size
 * limit stay in the route. Counterpart to the client `UpdateProfileSchema`.
 *
 * Every field is optional, and the route updates only the ones the request actually
 * carries. Your name and your photo are edited on two different tabs, so a save from
 * either has no opinion about the other's fields, and a field that arrives with a
 * default rather than being left out is a field that quietly overwrites what is
 * stored. That is why the crop values have no `.default()`: a name-only save would
 * otherwise recentre the avatar of everybody who ever moved theirs.
 */
export const UserProfileApiSchema = z.object({
  firstName: z.string().trim().min(1, 'First name and last name cannot be blank.').optional(),
  lastName: z.string().trim().min(1, 'First name and last name cannot be blank.').optional(),
  deleteAvatar: formBoolean,
  cropX: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : Number(v)),
    z.number().min(0).max(1).optional(),
  ),
  cropY: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : Number(v)),
    z.number().min(0).max(1).optional(),
  ),
  zoom: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : Number(v)),
    z.number().min(0.6).max(2.6).optional(),
  ),
  timezone: z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => !v || COMMON_TIMEZONES.includes(v as (typeof COMMON_TIMEZONES)[number]),
      'Invalid timezone.',
    ),
});

// The avatar field, and why it carries no size limit, live in one place now.


export const UpdateProfileSchema = z.object({
    firstName: z.string().trim().min(1, 'First name is required.').max(60, 'First name is too long.'),
    lastName: z.string().trim().min(1, 'Last name is required.').max(60, 'Last name is too long.'),
    // Email is read-only in the dialog; we don't validate it here.
    avatarFile: ImageFileOptional, // Optional file upload
    deleteAvatar: z.boolean().default(false), // Checkbox to delete avatar
    cropX: z.number().min(0).max(1).default(0.5),
    cropY: z.number().min(0).max(1).default(0.5),
    zoom: z.number().min(0.6).max(2.6).default(1),
  timezone: z.string().trim().optional(),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
// Form-side (pre-validation) shape: fields with `.default()` are optional here.
export type UpdateProfileRaw = z.input<typeof UpdateProfileSchema>;
