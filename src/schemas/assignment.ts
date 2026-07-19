import { z } from 'zod';
import { dateTimeLocalString } from './fields';

/** Datetime-local form field (shared with the course form). */
const DateTimeLocalForm = dateTimeLocalString;

const DateTimeLocalFormOptional = DateTimeLocalForm.or(z.literal(''))
  .optional()
  .transform((val) => {
    if (!val || val === '') return undefined;
    return val;
  });

const validateLateSubmissionStrings = (
  data: {
    allowLateSubmissions?: boolean;
    lateCutoff?: string;
    dueDate?: string;
    unlockAt?: string;
  },
  ctx: z.RefinementCtx,
) => {
  const allowLate = data.allowLateSubmissions ?? false;
  const dueRaw = data.dueDate;
  const cutoffRaw = data.lateCutoff;

  if (!dueRaw) return;
  const dueDate = new Date(dueRaw);

  if (data.unlockAt && new Date(data.unlockAt) > dueDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['unlockAt'],
      message: 'Available-from must be on or before the due date.',
    });
  }

  if (allowLate) {
    // A cutoff is optional: when set it closes late submissions at that time; when
    // blank there is no cutoff and late submissions are accepted with no deadline.
    if (cutoffRaw) {
      const cutoffDate = new Date(cutoffRaw);
      if (cutoffDate < dueDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lateCutoff'],
          message: 'Cutoff must be on or after the due date.',
        });
      }
    }
  } else if (cutoffRaw) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lateCutoff'],
      message: 'Remove the cutoff or enable late submissions.',
    });
  }
};

/**
 * Base object schema for assignment forms (no date transformation).
 */
const BaseAssignmentFormSchemaObject = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, 'Title must be at least 3 characters.')
      .max(200, 'Title is too long.'),
    description: z.string().trim().max(20000, 'Description is too long.').optional(),
    dueDate: DateTimeLocalForm,
    unlockAt: DateTimeLocalFormOptional,
    assignedToEveryone: z.boolean().default(true),
    allowLateSubmissions: z.boolean().default(false),
    lateCutoff: DateTimeLocalFormOptional,
    isPublished: z.boolean(),
    courseId: z.string().min(1, 'Course id is required.'),
  })
  .strict();

/**
 * CREATE FORM: includes publish flag and rule: if publishing, maxPoints > 0.
 * Uses form-only date validation (no transformation)
 */
const AssignmentFormSchemaWithValidation = BaseAssignmentFormSchemaObject.superRefine(
  validateLateSubmissionStrings,
);

export const CreateAssignmentFormSchema = AssignmentFormSchemaWithValidation;

/**
 * UPDATE: partial base schema + id + optional isPublished with validation.
 */
export const UpdateAssignmentSchema = BaseAssignmentFormSchemaObject.partial()
  .extend({
    id: z.string().min(1, 'Assignment id is required.'),
    isPublished: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.unlockAt && data.dueDate && new Date(data.unlockAt) > new Date(data.dueDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unlockAt'],
        message: 'Available-from must be on or before the due date.',
      });
    }

    if (
      data.allowLateSubmissions === undefined &&
      data.lateCutoff === undefined &&
      data.dueDate === undefined
    ) {
      return;
    }

    const allowLate = data.allowLateSubmissions ?? false;
    const dueRaw = data.dueDate;
    const cutoffRaw = data.lateCutoff;

    // A cutoff is optional when late is enabled (blank = no deadline). Nothing to
    // cross-check unless both a due date and a cutoff are present.
    if (!dueRaw || !cutoffRaw) return;

    const dueDate = new Date(dueRaw);
    const cutoffDate = new Date(cutoffRaw);

    if (allowLate && cutoffDate < dueDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lateCutoff'],
        message: 'Cutoff must be on or after the due date.',
      });
    }

    if (!allowLate && cutoffRaw) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lateCutoff'],
        message: 'Remove the cutoff or enable late submissions.',
      });
    }
  });

/** Export a form-only schema for UI, if you want the bare form without publish logic */
export const AssignmentFormSchema = AssignmentFormSchemaWithValidation;

/**
 * One override card in the create wizard (dates as datetime-local strings). A card targets
 * EITHER a student (userId + studentName) OR a group (groupId + groupName), never both. The
 * server enforces the exactly-one-target rule; the form just carries whichever it holds.
 */
const OverrideFormItem = z.object({
  userId: z.string().min(1).optional(),
  studentName: z.string().optional(),
  groupId: z.string().min(1).optional(),
  groupName: z.string().optional(),
  groupMemberCount: z.number().optional(),
  unlockAt: DateTimeLocalFormOptional,
  dueDate: DateTimeLocalFormOptional,
  allowLateSubmissions: z.boolean().optional(),
  lateCutoff: DateTimeLocalFormOptional,
});

/**
 * The create-assignment wizard: the base ("Everyone") fields plus a list of per-student
 * overrides. The base late/unlock rules are validated here; each override's effective
 * window is validated server-side (it needs the base row to resolve inherited fields).
 */
export const AssignmentWizardFormSchema = BaseAssignmentFormSchemaObject.extend({
  overrides: z.array(OverrideFormItem).default([]),
  // The group set a group target is drawn from. Set when the staff member picks a set in
  // the Assign-To section; the server pins the assignment's set when a group override is
  // created, so this is a UI convenience rather than something sent on assignment create.
  groupSetId: z.string().nullable().optional(),
  // Individual vs group classification (the wizard's Type step). Defaults to individual.
  isGroup: z.boolean().default(false),
}).superRefine((data, ctx) => {
  validateLateSubmissionStrings(data, ctx);
  // "Assign to specific students" needs at least one target (a student or a group).
  if (data.assignedToEveryone === false && (data.overrides?.length ?? 0) === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['overrides'],
      message: 'Add at least one student or group, or assign to everyone.',
    });
  }
  // A group assignment must be pinned to a group set (chosen in the Type step).
  if (data.isGroup && !data.groupSetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['groupSetId'],
      message: 'Select a group set for this group assignment.',
    });
  }
});

/**
 * Server (API) schemas for the assignment create/update routes. Dates stay as
 * strings (parsed in the course timezone server-side); field rules mirror the
 * routes they replaced. Distinct from the `*Form` schemas above.
 */
export const AssignmentCreateApiSchema = z.object({
  title: z.string().min(1, 'Missing required fields').max(200, 'Title is too long.'),
  description: z.string().max(20000, 'Description is too long.').optional(),
  dueDate: z.string().min(1, 'A due date is required.'),
  // Nullable so callers can send null to mean "no value" (the create UI sends
  // lateCutoff: null when late is off); the handler treats null and absent the same.
  unlockAt: z.string().nullable().optional(),
  assignedToEveryone: z.boolean().optional(),
  allowLateSubmissions: z.boolean().optional(),
  lateCutoff: z.string().nullable().optional(),
  isPublished: z.boolean().optional(),
  isGroup: z.boolean().optional(),
});

export const AssignmentUpdateApiSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  unlockAt: z.string().nullable().optional(),
  assignedToEveryone: z.boolean().optional(),
  allowLateSubmissions: z.boolean().optional(),
  lateCutoff: z.string().nullable().optional(),
  isPublished: z.boolean().optional(),
});

/**
 * Per-target due-date override (Canvas "Assign To"). Dates stay strings (parsed in the
 * course timezone server-side). Every deadline field is nullable/optional: omitted keeps
 * the existing value on update, a value sets it, and null means "inherit the assignment's
 * base value". The handler fetches the base assignment and validates the effective window,
 * because inherit-awareness can't live in the schema alone.
 */
const OverrideDateFields = {
  unlockAt: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  lateCutoff: z.string().nullable().optional(),
  allowLateSubmissions: z.boolean().nullable().optional(),
};

// A target is exactly one of a student (userId) or a group (groupId). The handler
// enforces the rest: the group belongs to the assignment's group set, and no student is
// targeted more than one way.
export const OverrideCreateApiSchema = z
  .object({
    userId: z.string().min(1).optional(),
    groupId: z.string().min(1).optional(),
    ...OverrideDateFields,
  })
  .superRefine((d, ctx) => {
    if (!!d.userId === !!d.groupId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['userId'],
        message: 'Provide exactly one target: a student or a group.',
      });
    }
  });

// Updates never change the target, only the dates/late policy.
export const OverrideUpdateApiSchema = z.object({ ...OverrideDateFields });

/** Types */
export type UpdateAssignmentInput = z.infer<typeof UpdateAssignmentSchema>;
export type AssignmentFormInput = z.infer<typeof AssignmentFormSchema>;
export type OverrideCreateInput = z.infer<typeof OverrideCreateApiSchema>;
export type OverrideUpdateInput = z.infer<typeof OverrideUpdateApiSchema>;
