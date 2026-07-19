import { describe, expect, it } from 'vitest';
import { assignedToStudentWhere, isStudentAssigned } from './assignment-visibility';

describe('isStudentAssigned', () => {
  it('assigns everyone when assignedToEveryone is true', () => {
    expect(isStudentAssigned({ assignedToEveryone: true }, [], 'stu-1')).toBe(true);
  });

  it('assigns only students with an assignee row when not everyone', () => {
    expect(
      isStudentAssigned({ assignedToEveryone: false }, [{ userId: 'stu-1' }], 'stu-1'),
    ).toBe(true);
    expect(
      isStudentAssigned({ assignedToEveryone: false }, [{ userId: 'other' }], 'stu-1'),
    ).toBe(false);
    expect(isStudentAssigned({ assignedToEveryone: false }, [], 'stu-1')).toBe(false);
  });

  it('defaults a missing flag to assigned', () => {
    // A partial select can omit the flag; the NOT NULL default is true.
    expect(isStudentAssigned({} as { assignedToEveryone: boolean }, [], 'stu-1')).toBe(true);
  });

  it('assigns a student via a group assignee row for a group they belong to', () => {
    const assignees = [{ userId: null, groupId: 'g1' }];
    expect(isStudentAssigned({ assignedToEveryone: false }, assignees, 'stu-1', ['g1'])).toBe(true);
    // Not a member of the targeted group -> not assigned.
    expect(isStudentAssigned({ assignedToEveryone: false }, assignees, 'stu-1', ['g2'])).toBe(false);
  });
});

describe('assignedToStudentWhere', () => {
  it('matches everyone, the student own assignee row, or a group they belong to', () => {
    expect(assignedToStudentWhere('stu-1')).toEqual({
      OR: [
        { assignedToEveryone: true },
        { assignees: { some: { userId: 'stu-1' } } },
        { assignees: { some: { studentGroup: { memberships: { some: { userId: 'stu-1' } } } } } },
      ],
    });
  });
});
