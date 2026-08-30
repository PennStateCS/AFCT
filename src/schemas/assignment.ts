import { z } from 'zod';
import { dateTimeLocalString } from './fields';
import { richDescriptionEnvelopeSchema } from '@/lib/rich-description';

// Optional versioned rich-description envelope accepted by the write APIs. When present it is
// authoritative and the server derives the plain-text `description` from it.
const descriptionJsonField = richDescriptionEnvelopeSchema.nullish();

/** Datetime-local form field (shared with the course form). */
const DateTimeLocalForm = dateTimeLocalString;

const DateTimeLocalFormOptional = DateTimeLocalForm.or(z.literal(''))
  .optional()
  .transform((val) => {
    if (!val || val === '') return undefined;
    return val;
  });

/**
 * The date rules, shared by the wizard and by the API schemas.
 *
 * Nullable as well as optional, because the form writes an empty string for "not set" and the
 * API writes null. Both are falsy, which is all the checks below care about.
 */
const validateLateSubmissionStrings = (
  data: {
    allowLateSubmissions?: boolean;
    lateCutoff?: string | null;
    dueDate?: string | null;
    unlockAt?: string | null;
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
    // The rich description as edited in the form. Present only once the author actually edits
    // the editor, which is what keeps a legacy plain-text record from converting on view.
    descriptionJson: descriptionJsonField,
    dueDate: DateTimeLocalForm,
    unlockAt: DateTimeLocalFormOptional,
    assignedToEveryone: z.boolean().default(true),
    allowLateSubmissions: z.boolean().default(false),
    // Defaults true, like the column: a new assignment scores missing work zero unless somebody
    // says otherwise. Existing assignments were switched off by the migration that added it.
    missingWorkIsZero: z.boolean().default(true),
    lateCutoff: DateTimeLocalFormOptional,
    isPublished: z.boolean(),
    courseId: z.string().min(1, 'Course id is required.'),
  })
  .strict();

/**
 * CREATE FORM: includes publish flag and rule: if publishing, maxPoints > 0.
 * Uses form-only date validation (no transformation)
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
  // The audience: one row per assigned student or group (no dates). Maps to AssignmentAssignee.
  overrides: z.array(OverrideFormItem).default([]),
  // Per-student/group date exceptions (assignment page only; the wizard leaves this empty).
  // Maps to AssignmentOverride rows. Shares the OverrideFormItem shape but carries dates.
  dateOverrides: z.array(OverrideFormItem).default([]),
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
/** One audience target on create: exactly one of a student (userId) or a group (groupId). */
const AssigneeApiItem = z
  .object({
    userId: z.string().min(1).optional(),
    groupId: z.string().min(1).optional(),
  })
  .refine((a) => !!a.userId !== !!a.groupId, {
    message: 'Each assignee is exactly one of a student or a group.',
  });

export const AssignmentCreateApiSchema = z
  .object({
    title: z.string().min(1, 'Missing required fields').max(200, 'Title is too long.'),
    description: z.string().max(20000, 'Description is too long.').optional(),
    descriptionJson: descriptionJsonField,
    dueDate: z.string().min(1, 'A due date is required.'),
    // Nullable so callers can send null to mean "no value" (the create UI sends
    // lateCutoff: null when late is off); the handler treats null and absent the same.
    unlockAt: z.string().nullable().optional(),
    assignedToEveryone: z.boolean().optional(),
    allowLateSubmissions: z.boolean().optional(),
    missingWorkIsZero: z.boolean().optional(),
    lateCutoff: z.string().nullable().optional(),
    isPublished: z.boolean().optional(),
    // Set for a group assignment (the group set it runs in); null/absent for individual.
    groupSetId: z.string().nullable().optional(),
    // The audience when assignedToEveryone is false: students (individual) or groups (group).
    // The handler validates each target and materializes AssignmentAssignee rows.
    assignees: z.array(AssigneeApiItem).optional(),
  })
  // The same date rules the wizard applies. They used to live on the form only, so a client
  // posting straight to the API could create an assignment that unlocks after it is due, or
  // carry a cutoff with late submissions switched off. The native client talks to this API,
  // so "the form checks it" was never the whole story.
  .superRefine(validateLateSubmissionStrings);

// What to do with the source assignment's problems when duplicating it:
//   none      - the copy starts with no problems
//   link      - the copy shares the same Problem records (editing one edits both)
//   duplicate - independent Problem copies are made (with their own solution files)
export const AssignmentProblemDuplicateMode = z.enum(['none', 'link', 'duplicate']);
export type AssignmentProblemDuplicateMode = z.infer<typeof AssignmentProblemDuplicateMode>;

// Duplicate an existing assignment. Only the title/description are editable here; the
// type (groupSetId), audience, schedule, and date exceptions are copied verbatim from
// the source (and are editable afterward). The copy is always created unpublished.
export const AssignmentDuplicateApiSchema = z.object({
  title: z.string().min(1, 'A title is required.').max(200, 'Title is too long.'),
  description: z.string().max(20000, 'Description is too long.').nullable().optional(),
  descriptionJson: descriptionJsonField,
  problemMode: AssignmentProblemDuplicateMode,
});

// How to handle the source assignment's problems on IMPORT. Unlike duplicate there is
// no "link" option: problems are course-scoped, so a problem from the source course
// can't be shared with an assignment in the destination course.
//   none - the imported assignment starts with no problems
//   copy - each problem is copied into the destination course (with its own solution file)
export const AssignmentImportProblemMode = z.enum(['none', 'copy']);
export type AssignmentImportProblemMode = z.infer<typeof AssignmentImportProblemMode>;

// Import an assignment from another course the caller can manage. Audience, group set,
// and date exceptions are NOT carried across (they reference course-scoped records);
// the copy is created unpublished and assigned to everyone. The schedule (due date,
// available-from, late settings) IS copied from the source as a starting point.
export const AssignmentImportApiSchema = z.object({
  sourceCourseId: z.string().min(1, 'Select a course to import from.'),
  sourceAssignmentId: z.string().min(1, 'Select an assignment to import.'),
  title: z.string().min(1, 'A title is required.').max(200, 'Title is too long.'),
  description: z.string().max(20000, 'Description is too long.').nullable().optional(),
  descriptionJson: descriptionJsonField,
  problemMode: AssignmentImportProblemMode,
});

export const AssignmentUpdateApiSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  descriptionJson: descriptionJsonField,
  dueDate: z.string().optional(),
  unlockAt: z.string().nullable().optional(),
  // NOTE: assignedToEveryone and groupSetId are intentionally NOT here. The audience
  // (assignedToEveryone + assignees) is changed only via the assignees route, and the type
  // (groupSetId) only via the type route, so those invariants stay guarded.
  allowLateSubmissions: z.boolean().optional(),
  missingWorkIsZero: z.boolean().optional(),
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

/**
 * Extra submissions for one student or group on one assignment problem, on top of the
 * problem's shared cap. Additive: repeat grants to the same target accumulate. The
 * handler enforces the rest: the target is on the roster / in the assignment's group
 * set, and the problem's cap is not unlimited (a grant would change nothing).
 */
export const SubmissionGrantCreateApiSchema = z
  .object({
    userId: z.string().min(1).optional(),
    groupId: z.string().min(1).optional(),
    extraSubmissions: z.number().int().min(1).max(100),
    reason: z.string().trim().max(500).optional(),
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

/**
 * Change an assignment's individual/group type. `groupSetId` null makes it individual; a
 * set id makes it a group assignment tied to that set. Switching type resets the audience
 * and clears every assignee + override (they reference the old type's targets), so the
 * handler does that in one transaction.
 */
export const AssignmentTypeApiSchema = z.object({
  groupSetId: z.string().min(1).nullable(),
});

/**
 * Replace an assignment's audience (who is assigned). `assignedToEveryone` true clears the
 * explicit list (everyone / all groups); false requires at least one assignee, each a
 * student (individual assignment) or a group (group assignment). Validated + materialized
 * in the handler, which also drops overrides for anyone no longer assigned.
 */
export const AssigneesPutApiSchema = z
  .object({
    assignedToEveryone: z.boolean(),
    assignees: z.array(AssigneeApiItem).default([]),
  })
  .superRefine((data, ctx) => {
    if (!data.assignedToEveryone && data.assignees.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assignees'],
        message: 'Assign to at least one student or group, or assign to everyone.',
      });
    }
  });

/** Types */
export type OverrideCreateInput = z.infer<typeof OverrideCreateApiSchema>;
export type OverrideUpdateInput = z.infer<typeof OverrideUpdateApiSchema>;
export type SubmissionGrantCreateInput = z.infer<typeof SubmissionGrantCreateApiSchema>;
