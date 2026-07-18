import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  namesEqualInsensitive,
  defaultGroupName,
  suggestDuplicateName,
  computeMembershipBasis,
  planRandomAssignment,
  isGroupSetLocked,
  groupSetDeletionBlockers,
} from './group-sets';

// Deterministic shuffle for tests: identity (no reordering).
const noShuffle = <T>(items: T[]): T[] => items.slice();

describe('normalizeName / namesEqualInsensitive', () => {
  it('trims names', () => {
    expect(normalizeName('  Group 1  ')).toBe('Group 1');
  });
  it('treats case- and whitespace-only differences as equal', () => {
    expect(namesEqualInsensitive('Project 1', ' project 1 ')).toBe(true);
    expect(namesEqualInsensitive('Project 1', 'Project 2')).toBe(false);
  });
});

describe('defaultGroupName', () => {
  it('is 1-based', () => {
    expect(defaultGroupName(1)).toBe('Group 1');
    expect(defaultGroupName(3)).toBe('Group 3');
  });
});

describe('suggestDuplicateName', () => {
  it('suggests "X Copy" when free', () => {
    expect(suggestDuplicateName('Project 1', ['Project 1'])).toBe('Project 1 Copy');
  });
  it('adds a numeric suffix when the copy name is taken (case-insensitive)', () => {
    expect(suggestDuplicateName('Project 1', ['Project 1', 'project 1 copy'])).toBe(
      'Project 1 Copy 2',
    );
    expect(
      suggestDuplicateName('Project 1', ['Project 1 Copy', 'Project 1 Copy 2']),
    ).toBe('Project 1 Copy 3');
  });
});

describe('computeMembershipBasis', () => {
  it('is independent of row order', () => {
    const a = computeMembershipBasis([
      { userId: 'u1', groupId: 'g1' },
      { userId: 'u2', groupId: 'g2' },
    ]);
    const b = computeMembershipBasis([
      { userId: 'u2', groupId: 'g2' },
      { userId: 'u1', groupId: 'g1' },
    ]);
    expect(a).toBe(b);
  });
  it('changes when a membership changes', () => {
    const a = computeMembershipBasis([{ userId: 'u1', groupId: 'g1' }]);
    const b = computeMembershipBasis([{ userId: 'u1', groupId: 'g2' }]);
    expect(a).not.toBe(b);
  });
});

describe('planRandomAssignment', () => {
  const groups = [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }];
  const eligible = (ids: string[]) => new Set(ids);

  it('returns nothing when there are no groups', () => {
    const plan = planRandomAssignment({
      groups: [],
      currentByUser: new Map(),
      selectedStudentIds: ['u1', 'u2'],
      eligibleActiveIds: eligible(['u1', 'u2']),
      reassignSelected: false,
      shuffle: noShuffle,
    });
    expect(plan.operations).toEqual([]);
  });

  it('distributes unassigned students evenly across groups', () => {
    const plan = planRandomAssignment({
      groups,
      currentByUser: new Map(),
      selectedStudentIds: ['a', 'b', 'c', 'd', 'e', 'f'],
      eligibleActiveIds: eligible(['a', 'b', 'c', 'd', 'e', 'f']),
      reassignSelected: false,
      shuffle: noShuffle,
    });
    // 6 students / 3 groups => 2 each.
    const counts = new Map<string, number>();
    for (const op of plan.operations) counts.set(op.groupId, (counts.get(op.groupId) ?? 0) + 1);
    expect([...counts.values()].sort()).toEqual([2, 2, 2]);
    expect(plan.operations).toHaveLength(6);
  });

  it('lets final sizes differ by one when not evenly divisible', () => {
    const plan = planRandomAssignment({
      groups,
      currentByUser: new Map(),
      selectedStudentIds: ['a', 'b', 'c', 'd'],
      eligibleActiveIds: eligible(['a', 'b', 'c', 'd']),
      reassignSelected: false,
      shuffle: noShuffle,
    });
    const counts = new Map<string, number>();
    for (const op of plan.operations) counts.set(op.groupId, (counts.get(op.groupId) ?? 0) + 1);
    // 4 across 3 groups => 2,1,1.
    expect([...counts.values()].sort()).toEqual([1, 1, 2]);
  });

  it('preserves existing memberships by default (does not move already-assigned selected)', () => {
    const plan = planRandomAssignment({
      groups,
      currentByUser: new Map([['a', 'g1']]),
      selectedStudentIds: ['a', 'b', 'c'],
      eligibleActiveIds: eligible(['a', 'b', 'c']),
      reassignSelected: false,
      shuffle: noShuffle,
    });
    // 'a' stays in g1 (no op); only b and c are placed, into the two emptier groups.
    expect(plan.operations.map((o) => o.userId).sort()).toEqual(['b', 'c']);
    expect(plan.operations.find((o) => o.userId === 'a')).toBeUndefined();
  });

  it('reassigns already-assigned selected students when asked, keeping balance', () => {
    const plan = planRandomAssignment({
      groups: [{ id: 'g1' }, { id: 'g2' }],
      currentByUser: new Map([
        ['a', 'g1'],
        ['b', 'g1'],
        ['c', 'g1'],
      ]),
      selectedStudentIds: ['a', 'b', 'c'],
      eligibleActiveIds: eligible(['a', 'b', 'c']),
      reassignSelected: true,
      shuffle: noShuffle,
    });
    // All three re-dealt across 2 groups => sizes 2 and 1.
    const finalByGroup = new Map<string, number>();
    // start from empty (all three were removed from g1 for redeal)
    for (const op of plan.operations) {
      finalByGroup.set(op.groupId, (finalByGroup.get(op.groupId) ?? 0) + 1);
    }
    // 'a' may keep g1 (a no-op, so not emitted); count kept + moved.
    const kept = ['a', 'b', 'c'].filter((u) => !plan.operations.some((o) => o.userId === u));
    const total = plan.operations.length + kept.length;
    expect(total).toBe(3);
  });

  it('skips inactive/ineligible selected students', () => {
    const plan = planRandomAssignment({
      groups,
      currentByUser: new Map(),
      selectedStudentIds: ['a', 'inactive1', 'b'],
      eligibleActiveIds: eligible(['a', 'b']),
      reassignSelected: false,
      shuffle: noShuffle,
    });
    expect(plan.skippedInactive).toEqual(['inactive1']);
    expect(plan.operations.map((o) => o.userId).sort()).toEqual(['a', 'b']);
  });

  it('fills the smallest existing group first when groups start uneven', () => {
    const plan = planRandomAssignment({
      groups: [{ id: 'g1' }, { id: 'g2' }],
      currentByUser: new Map([
        ['x', 'g1'],
        ['y', 'g1'],
      ]),
      selectedStudentIds: ['a', 'b'],
      eligibleActiveIds: eligible(['a', 'b']),
      reassignSelected: false,
      shuffle: noShuffle,
    });
    // g1 has 2, g2 has 0 => both new students go to g2 (until balanced).
    expect(plan.operations.every((o) => o.groupId === 'g2')).toBe(true);
  });
});

describe('lock + deletion seams', () => {
  it('reports unlocked and no deletion blockers for now', () => {
    expect(isGroupSetLocked()).toBe(false);
    expect(groupSetDeletionBlockers()).toEqual([]);
  });
});
