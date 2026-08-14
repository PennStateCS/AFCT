// src/schemas/user.ts
import { z } from 'zod';
import { formBoolean, formBooleanOptional } from './fields';
import { passwordRules, PASSWORD_MAX_LENGTH } from '@/lib/password-policy';
import { COURSE_ROLE_VALUES } from '@/lib/course-roles';
import { ImageFileOptional } from './image-file';

// App-level role set (no Prisma counterpart; the global User.role was dropped).
export const RoleEnum = z.enum(['ADMIN', 'FACULTY', 'TA', 'STUDENT']);
// Built from the plain literal in lib/course-roles rather than z.nativeEnum, so this schema
// stays importable from client components without pulling @prisma/client into the browser
// bundle. The list lives over there, not here, so that the roster tables can read it without
// importing this module and dragging zod along with it.
export const CourseRoleEnum = z.enum(COURSE_ROLE_VALUES);

/** Body for changing a user's course role (CourseEditUserDialog ↔ roster/[userId] PATCH). */
export const CourseRoleChangeSchema = z.object({ role: CourseRoleEnum });

// Keep in sync with the Prisma `EnrollmentStatus` enum. String literals (not
// z.nativeEnum) so this stays importable from client components.
export const EnrollmentStatusEnum = z.enum(['ENROLLED', 'DROPPED']);

/** Body for dropping / re-enrolling a student (roster/[userId]/status PATCH). */
export const EnrollmentStatusChangeSchema = z.object({ status: EnrollmentStatusEnum });

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

// The avatar field, and why it carries no size limit, live in one place now.


export const UpdateUserSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.').max(60, 'First name is too long.'),
  lastName: z.string().trim().min(1, 'Last name is required.').max(60, 'Last name is too long.'),
  isAdmin: z.boolean().default(false),
  avatarFile: ImageFileOptional,
  cropX: z.number().min(0).max(1).default(0.5),
  cropY: z.number().min(0).max(1).default(0.5),
  zoom: z.number().min(0.6).max(2.6).default(1),
  deleteAvatar: z.boolean().default(false),
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
  // Admin-only email change (Change Email dialog). Normalized + uniqueness-checked
  // in the route; the transform keeps it lowercase to match the stored form.
  email: z
    .string()
    .trim()
    .email('Enter a valid email.')
    .max(254, 'Email is too long.')
    .transform((v) => v.toLowerCase())
    .optional(),
  timezone: z.string().optional(),
  isAdmin: z.boolean().optional(),
  cropX: z.number().min(0).max(1).optional(),
  cropY: z.number().min(0).max(1).optional(),
  zoom: z.number().min(0.6).max(2.6).optional(),
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
  timezone: z.string().optional(),
  isAdmin: formBooleanOptional,
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type CreateUserRaw = z.input<typeof CreateUserSchema>;

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type UpdateUserRaw = z.input<typeof UpdateUserSchema>;
