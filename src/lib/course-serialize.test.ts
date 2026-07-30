import { describe, expect, it } from 'vitest';
import { serializeAssignment, type AssignmentRow } from '@/lib/course-serialize';

const NOW = new Date('2026-03-10T12:00:00.000Z');
const HOUR = 3600_000;

const row = (over: Partial<AssignmentRow> = {}): AssignmentRow => ({
  id: 'a1',
  title: 'Regular expressions',
  description: 'Build an RE for the language.',
  courseId: 'c1',
  isPublished: true,
  createdAt: NOW,
  updatedAt: NOW,
  dueDate: new Date(NOW.getTime() + 48 * HOUR),
  unlockAt: null,
  allowLateSubmissions: false,
  lateCutoff: null,
  assignedToEveryone: true,
  groupSetId: null,
  problems: [{ maxPoints: 6 }, { maxPoints: 4 }],
  _count: { problems: 2 },
  overrides: [],
  ...over,
});

const ctx = (over: Partial<Parameters<typeof serializeAssignment>[1]> = {}) => ({
  isStaff: false,
  viewerId: 'student-1',
  submissionCounts: new Map<string, number>(),
  commentCounts: new Map<string, number>(),
  now: NOW,
  ...over,
});

describe('serializeAssignment: derived fields', () => {
  it('totals the points of the assignment problems', () => {
    expect(serializeAssignment(row(), ctx()).maxPoints).toBe(10);
  });

  it('derives group from the group-set link, with no stored flag', () => {
    expect(serializeAssignment(row(), ctx()).isGroup).toBe(false);
    expect(serializeAssignment(row({ groupSetId: 'gs1' }), ctx()).isGroup).toBe(true);
  });

  it('flags an assignment that already has submissions or comments', () => {
    const counts = new Map([['a1', 2]]);
    const staff = ctx({ isStaff: true, submissionCounts: counts });
    expect(serializeAssignment(row(), staff)).toMatchObject({
      submissionCount: 2,
      commentCount: 0,
      hasSubmissionsOrComments: true,
    });
    expect(serializeAssignment(row(), ctx({ isStaff: true }))).toMatchObject({
      hasSubmissionsOrComments: false,
    });
  });

  it('leaves the counts at zero for a student, since those queries never run', () => {
    // The route skips the aggregate queries for a non-staff viewer, so the maps arrive
    // empty. The serializer must not invent a count from anything else.
    expect(serializeAssignment(row(), ctx())).toMatchObject({
      submissionCount: 0,
      commentCount: 0,
    });
  });
});

describe('serializeAssignment: content lock', () => {
  const locked = { unlockAt: new Date(NOW.getTime() + 24 * HOUR) };
  const opened = { unlockAt: new Date(NOW.getTime() - 24 * HOUR) };

  // A rich document, carried alongside the plain text. Masking one but not the other would
  // either leak the locked prompt or leave staff without the formatted form.
  const richJson = {
    version: 1,
    document: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Build an RE.' }] }],
    },
  };

  it('withholds the prompt from a student before the unlock time', () => {
    const out = serializeAssignment(row({ ...locked, descriptionJson: richJson }), ctx());
    expect(out.locked).toBe(true);
    expect(out.description).toBeNull();
    // Both forms, or the lock leaks through the rich copy.
    expect(out.descriptionJson).toBeNull();
    expect(JSON.stringify(out)).not.toContain('Build an RE.');
    // The assignment's existence and opening time are still disclosed.
    expect(out.title).toBe('Regular expressions');
    expect(out.unlockAt).toEqual(locked.unlockAt);
  });

  it('releases both forms of the prompt once unlocked', () => {
    const out = serializeAssignment(row({ ...opened, descriptionJson: richJson }), ctx());
    expect(out.locked).toBe(false);
    expect(out.descriptionJson).toEqual(richJson);
  });

  it('sends the rich form to staff regardless of the unlock time', () => {
    const out = serializeAssignment(
      row({ ...locked, descriptionJson: richJson }),
      ctx({ isStaff: true }),
    );
    expect(out.descriptionJson).toEqual(richJson);
  });

  it('reports a null rich document when the assignment has none', () => {
    const out = serializeAssignment(row(opened), ctx());
    expect(out.descriptionJson).toBeNull();
  });

  it('releases the prompt once the unlock time has passed', () => {
    const out = serializeAssignment(row(opened), ctx());
    expect(out.locked).toBe(false);
    expect(out.description).toBe('Build an RE for the language.');
  });

  it('never locks staff out, whatever the unlock time says', () => {
    const out = serializeAssignment(row(locked), ctx({ isStaff: true }));
    expect(out.locked).toBe(false);
    expect(out.description).toBe('Build an RE for the language.');
  });

  it('honours a student override that opens the assignment early', () => {
    const out = serializeAssignment(
      row({
        ...locked,
        overrides: [
          {
            targetType: 'STUDENT',
            userId: 'student-1',
            groupId: null,
            unlockAt: new Date(NOW.getTime() - HOUR),
            dueDate: null,
            lateCutoff: null,
            allowLateSubmissions: null,
          },
        ],
      }),
      ctx(),
    );
    expect(out.locked).toBe(false);
    expect(out.description).not.toBeNull();
  });

  it('honours a group override the viewer belongs to', () => {
    const out = serializeAssignment(
      row({
        ...locked,
        overrides: [
          {
            targetType: 'GROUP',
            userId: null,
            groupId: 'g1',
            unlockAt: new Date(NOW.getTime() - HOUR),
            dueDate: null,
            lateCutoff: null,
            allowLateSubmissions: null,
          },
        ],
      }),
      ctx(),
    );
    expect(out.locked).toBe(false);
  });

  it('treats an assignment with no due date as unlocked', () => {
    const out = serializeAssignment(row({ dueDate: undefined, ...locked }), ctx());
    expect(out.locked).toBe(false);
  });
});

describe('serializeAssignment: override disclosure', () => {
  const withOverride = row({
    overrides: [
      {
        targetType: 'STUDENT',
        userId: 'student-2',
        groupId: null,
        unlockAt: null,
        dueDate: new Date(NOW.getTime() + 96 * HOUR),
        lateCutoff: null,
        allowLateSubmissions: true,
        user: { firstName: 'Dana', lastName: 'Reyes', email: 'dana@example.edu' },
      },
    ],
  });

  it('names the student on an override for staff', () => {
    const out = serializeAssignment(withOverride, ctx({ isStaff: true }));
    expect(out.overrides).toHaveLength(1);
    expect(out.overrides[0]).toMatchObject({
      studentName: 'Dana Reyes',
      allowLateSubmissions: true,
    });
  });

  it('falls back to the email when the student has no name on file', () => {
    const noName = row({
      overrides: [
        {
          targetType: 'STUDENT',
          userId: 'student-2',
          groupId: null,
          unlockAt: null,
          dueDate: null,
          lateCutoff: null,
          allowLateSubmissions: null,
          user: { firstName: null, lastName: null, email: 'dana@example.edu' },
        },
      ],
    });
    expect(serializeAssignment(noName, ctx({ isStaff: true })).overrides[0]).toMatchObject({
      studentName: 'dana@example.edu',
    });
  });

  it('sends a student no overrides at all, not even their own', () => {
    // A student's own overrides ARE loaded, to resolve their unlock time above. They
    // must still never be serialized, or one student learns another's due date.
    const out = serializeAssignment(withOverride, ctx());
    expect(out.overrides).toEqual([]);
    expect(JSON.stringify(out)).not.toContain('dana@example.edu');
    expect(JSON.stringify(out)).not.toContain('Reyes');
  });
});
