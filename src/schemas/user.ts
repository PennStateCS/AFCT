// src/schemas/user.ts
import { z } from 'zod';
import { formBoolean, formBooleanOptional } from './fields';
import { passwordRules, PASSWORD_MAX_LENGTH } from '@/lib/password-policy';

// App-level role set (no Prisma counterpart; the global User.role was dropped).
export const RoleEnum = z.enum(['ADMIN', 'FACULTY', 'TA', 'STUDENT']);
// Keep in sync with the Prisma `CourseRole` enum. Kept as string literals (not
// z.nativeEnum) so this schema stays importable from client components without
// pulling @prisma/client into the browser bundle.
export const CourseRoleEnum = z.enum(['FACULTY', 'TA', 'STUDENT']);

/** Body for changing a user's course role (CourseEditUserDialog ↔ roster/[userId] PATCH). */
export const CourseRoleChangeSchema = z.object({ role: CourseRoleEnum });

/**
 * Strong password: capped at the bcrypt 72-byte limit and checked against the
 * shared {@link passwordRules} (the same rules the checklist UI shows), so the
 * schema can't drift from the `isStrongPassword` predicate.
 */
export const StrongPassword = z
  .string()
  .max(PASSWORD_MAX_LENGTH, `At most ${PASSWORD_MAX_LENGTH} characters.`)
  .superRefine((val, ctx) => {
    for (const rule of passwordRules) {
      if (!rule.test(val)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: rule.label });
      }
    }
  });

const BaseUserSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.').max(60, 'First name is too long.'),
  lastName: z.string().trim().min(1, 'Last name is required.').max(60, 'Last name is too long.'),
  email: z
    .string()
    .trim()
    .email('Enter a valid email.')
    .max(254, 'Email is too long.')
    .transform((v) => v.toLowerCase()),
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
  isAdmin: z.boolean().default(false),
  avatarFile: ImageFileOptional,
  deleteAvatar: z.boolean().default(false),
  inactive: z.boolean(),
  timezone: z.string().trim().optional(),
});

/**
 * Server (API) bodies for the admin user routes. These validate the raw JSON the
 * routes receive (distinct from the client `CreateUserSchema`/`UpdateUserSchema`
 * form schemas, which also carry confirm-password / avatar-file fields). Field
 * rules mirror the routes they replaced.
 */
export const UserCreateApiSchema = z.object({
  email: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  password: z.string().min(1),
  timezone: z.string().optional(),
});

/** JSON branch of PATCH /api/users/[id] (the multipart branch carries the avatar). */
export const UserUpdateJsonApiSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  inactive: z.boolean().optional(),
  timezone: z.string().optional(),
  isAdmin: z.boolean().optional(),
});

/**
 * Multipart branch of PATCH /api/users/[id] (carries the avatar File). Booleans
 * arrive as form strings, so they use the form-data coercers: `inactive` /
 * `deleteAvatar` default false when absent, `isAdmin` stays tri-state.
 */
export const UserUpdateFormApiSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  inactive: formBoolean,
  deleteAvatar: formBoolean,
  timezone: z.string().optional(),
  isAdmin: formBooleanOptional,
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type CreateUserRaw = z.input<typeof CreateUserSchema>;

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type UpdateUserRaw = z.input<typeof UpdateUserSchema>;
