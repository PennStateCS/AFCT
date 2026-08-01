import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignment: { findUnique: vi.fn() },
  groupMembership: { findMany: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { resolveStudentAssignmentGroupIds, resolveStudentSubmissionGroupId } from './assignment-groups';

/**
 * The single definition of "which group is this student in, for this assignment".
 *
 * Five call sites depend on it (the two submission paths, the staff review data, the
 * per-student group lookup and the submission detail read), so a change in meaning here moves
 * what students are allowed to do. The rule it encodes: a group assignment means the members
 * share one submission set and one cap, so the group collectively gets the problem's
 * `maxSubmissions`, not that many each.
 *
 * It reads GroupMembership, deliberately. The previous version read GROUP `AssignmentOverride`
 * rows, which are date-only and absent from an ordinary group assignment, so it returned
 * nothing and the members submitted as individuals.
 */

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.assignment.findUnique.mockResolvedValue({ groupSetId: 'gs-1' });
  prismaMock.groupMembership.findMany.mockResolvedValue([{ groupId: 'group-9' }]);
});

describe('resolveStudentAssignmentGroupIds', () => {
  it("returns the student's group in the assignment's set", async () => {
    await expect(resolveStudentAssignmentGroupIds('a-1', 'u-1')).resolves.toEqual(['group-9']);
    expect(prismaMock.groupMembership.findMany).toHaveBeenCalledWith({
      where: { groupSetId: 'gs-1', userId: 'u-1' },
      select: { groupId: true },
    });
  });

  it('does not depend on the assignment carrying an assignee or override row', async () => {
    // The default group assignment has neither. Nothing here consults them.
    await resolveStudentAssignmentGroupIds('a-1', 'u-1');
    const where = prismaMock.groupMembership.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('assignmentId');
    expect(JSON.stringify(where)).not.toContain('override');
  });

  it('is empty for an individual assignment, without asking about memberships', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({ groupSetId: null });
    await expect(resolveStudentAssignmentGroupIds('a-1', 'u-1')).resolves.toEqual([]);
    expect(prismaMock.groupMembership.findMany).not.toHaveBeenCalled();
  });

  it('is empty when the assignment does not exist', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue(null);
    await expect(resolveStudentAssignmentGroupIds('nope', 'u-1')).resolves.toEqual([]);
    expect(prismaMock.groupMembership.findMany).not.toHaveBeenCalled();
  });

  it('is empty for a student in the course but in none of the set’s groups', async () => {
    prismaMock.groupMembership.findMany.mockResolvedValue([]);
    await expect(resolveStudentAssignmentGroupIds('a-1', 'u-1')).resolves.toEqual([]);
  });

  it('scopes the membership lookup to this set, so another set’s group cannot leak in', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({ groupSetId: 'gs-2' });
    await resolveStudentAssignmentGroupIds('a-1', 'u-1');
    expect(prismaMock.groupMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ groupSetId: 'gs-2' }) }),
    );
  });
});

describe('resolveStudentSubmissionGroupId', () => {
  it('is the one group when there is one', async () => {
    await expect(resolveStudentSubmissionGroupId('a-1', 'u-1')).resolves.toBe('group-9');
  });

  it('is null for an individual assignment', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({ groupSetId: null });
    await expect(resolveStudentSubmissionGroupId('a-1', 'u-1')).resolves.toBeNull();
  });

  it('is null for an ungrouped student', async () => {
    prismaMock.groupMembership.findMany.mockResolvedValue([]);
    await expect(resolveStudentSubmissionGroupId('a-1', 'u-1')).resolves.toBeNull();
  });
});
