import { z } from 'zod';

const groupName = z.string().trim().min(1, 'Name is required');

/**
 * Server body for creating or renaming a group — the name only; the courseId (and
 * groupId, for rename) come from the path. Shared by both group routes.
 */
export const GroupNameSchema = z.object({ name: groupName });

/** Client create-group form: name + course selection. */
export const CreateGroupSchema = z.object({
  name: groupName,
  courseId: z.string().trim().min(1, 'Course is required'),
});

/** Client rename form, and the rename route body. */
export const UpdateGroupSchema = GroupNameSchema;

export type CreateGroupRaw = z.infer<typeof CreateGroupSchema>;
export type CreateGroupInput = z.infer<typeof CreateGroupSchema>;
export type UpdateGroupInput = z.infer<typeof UpdateGroupSchema>;
