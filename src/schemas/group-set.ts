import { z } from 'zod';

// Reasonable name limits, matching the course/assignment conventions
// (trim + min 1 + max 100).
const setOrGroupName = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(100, 'Name is too long (100 characters max).');

/** Create a group set. Optionally seed a number of empty groups. */
export const CreateGroupSetSchema = z.object({
  name: setOrGroupName,
  // Optional convenience: create this many empty, default-named groups up front.
  initialGroupCount: z.coerce.number().int().min(0).max(50).optional(),
});

/** Rename a group set (name only; ids come from the path). */
export const RenameGroupSetSchema = z.object({ name: setOrGroupName });

/** Duplicate a group set into a new, independent set in the same course. */
export const DuplicateGroupSetSchema = z.object({
  name: setOrGroupName,
  // false: copy groups only. true: also copy current active-student memberships.
  includeMemberships: z.boolean().default(false),
});

/** Create a single group inside a set, or rename one (name only). */
export const GroupNameBodySchema = z.object({ name: setOrGroupName });

/**
 * Atomic bulk membership change within a set. Each operation sets one student's
 * group to `groupId`, or removes them when `groupId` is null. Because the write
 * is an upsert on the (set, student) unique key, a move never passes through a
 * two-group state. `expectedBasis` is an optional optimistic-concurrency token
 * (see computeMembershipBasis); when present and stale, the server returns 409.
 */
export const AssignMembershipsSchema = z.object({
  operations: z
    .array(
      z.object({
        userId: z.string().trim().min(1),
        groupId: z.string().trim().min(1).nullable(),
      }),
    )
    .min(1, 'No changes were provided.')
    .max(1000),
  expectedBasis: z.string().optional(),
});

/**
 * Preview a random assignment. `studentIds` are the students to distribute;
 * `reassignSelected` decides whether selected students who already hold a group
 * are moved (true) or left where they are and excluded from the shuffle (false).
 */
export const RandomAssignPreviewSchema = z.object({
  studentIds: z.array(z.string().trim().min(1)).min(0).max(2000),
  reassignSelected: z.boolean().default(false),
});

export type CreateGroupSetInput = z.infer<typeof CreateGroupSetSchema>;
export type RenameGroupSetInput = z.infer<typeof RenameGroupSetSchema>;
export type DuplicateGroupSetInput = z.infer<typeof DuplicateGroupSetSchema>;
export type GroupNameBodyInput = z.infer<typeof GroupNameBodySchema>;
export type AssignMembershipsInput = z.infer<typeof AssignMembershipsSchema>;
export type RandomAssignPreviewInput = z.infer<typeof RandomAssignPreviewSchema>;
