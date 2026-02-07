import { z } from 'zod';

export const CreateGroupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  courseId: z.string().trim().min(1, 'Course is required'),
});

export const UpdateGroupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
});

export type CreateGroupRaw = z.infer<typeof CreateGroupSchema>;
export type CreateGroupInput = z.infer<typeof CreateGroupSchema>;
export type UpdateGroupInput = z.infer<typeof UpdateGroupSchema>;
