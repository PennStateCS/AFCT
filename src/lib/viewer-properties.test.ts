import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  submission: { findFirst: vi.fn() },
  problem: { findFirst: vi.fn() },
}));
const canManageCourseMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/permissions', () => ({ canManageCourse: canManageCourseMock }));

import { loadViewerProperties } from './viewer-properties';

const STAFF = { id: 'staff-1', isAdmin: false };
const OWNER = { id: 'student-1', isAdmin: false };
const OUTSIDER = { id: 'someone-else', isAdmin: false };

const submission = {
  originalFileName: 'answer.jff',
  createdAt: new Date('2026-03-04T09:05:00Z'),
  studentId: 'student-1',
  courseId: 'course-1',
  student: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test' },
  studentGroup: null,
  course: { name: 'Automata', code: 'CMPEN 331' },
  assignmentProblem: {
    assignment: { title: 'Homework 2' },
    problem: { title: 'Three consecutive 1s', type: 'FA' },
  },
};

const value = (rows: { label: string; value: string }[], label: string) =>
  rows.find((r) => r.label === label)?.value;

describe('loadViewerProperties', () => {
  beforeEach(() => {
    prismaMock.submission.findFirst.mockReset();
    prismaMock.problem.findFirst.mockReset();
    canManageCourseMock.mockReset();
  });

  it('tells course staff where a submission came from', async () => {
    prismaMock.submission.findFirst.mockResolvedValue(submission);
    canManageCourseMock.mockResolvedValue(true);

    const props = await loadViewerProperties('submissions', 'stored.jff', STAFF);
    expect(value(props!.rows, 'Course')).toBe('CMPEN 331 Automata');
    expect(value(props!.rows, 'Assignment')).toBe('Homework 2');
    expect(value(props!.rows, 'Problem')).toBe('Three consecutive 1s');
    expect(value(props!.rows, 'Kind')).toBe('Student submission');
    expect(value(props!.rows, 'Student')).toBe('Ada Lovelace');
    expect(value(props!.rows, 'Submitted')).toContain('2026-03-04');
  });

  it('says nothing about grades, which this viewer deliberately does not show', async () => {
    // The viewer was scoped as a tool for looking at the machines. A properties panel is
    // exactly where that decision would quietly erode.
    prismaMock.submission.findFirst.mockResolvedValue(submission);
    canManageCourseMock.mockResolvedValue(true);

    const props = await loadViewerProperties('submissions', 'stored.jff', STAFF);
    const labels = props!.rows.map((r) => r.label.toLowerCase()).join(' ');
    expect(labels).not.toMatch(/grade|score|correct|verdict|points/);
  });

  it('lets the submitting student see their own', async () => {
    prismaMock.submission.findFirst.mockResolvedValue(submission);
    canManageCourseMock.mockResolvedValue(false);

    expect(await loadViewerProperties('submissions', 'stored.jff', OWNER)).not.toBeNull();
  });

  it('refuses somebody who is neither, without saying which reason', async () => {
    // "No such file" and "not yours" return the same null, so the panel cannot be used to
    // probe for which files exist.
    prismaMock.submission.findFirst.mockResolvedValue(submission);
    canManageCourseMock.mockResolvedValue(false);
    expect(await loadViewerProperties('submissions', 'stored.jff', OUTSIDER)).toBeNull();

    prismaMock.submission.findFirst.mockResolvedValue(null);
    expect(await loadViewerProperties('submissions', 'missing.jff', STAFF)).toBeNull();
  });

  it('names the group and the person who uploaded, on group work', async () => {
    // The grade counts for the group, so the group has to be named. Somebody still uploaded
    // the file, and losing that would make it impossible to say who did.
    prismaMock.submission.findFirst.mockResolvedValue({
      ...submission,
      studentGroup: { name: 'Team 4' },
    });
    canManageCourseMock.mockResolvedValue(true);

    const props = await loadViewerProperties('submissions', 'stored.jff', STAFF);
    expect(value(props!.rows, 'Kind')).toBe('Student submission (group work)');
    expect(value(props!.rows, 'Group')).toBe('Team 4');
    expect(value(props!.rows, 'Uploaded by')).toBe('Ada Lovelace');
  });

  it('says outright whether a file is a solution or a student attempt', async () => {
    // The two look identical on the canvas, and mistaking the answer key for a student's work
    // is the expensive confusion here.
    prismaMock.problem.findFirst.mockResolvedValue({
      title: 'Three consecutive 1s',
      type: 'FA',
      originalFileName: 'solution.jff',
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-02-03T00:00:00Z'),
      courseId: 'course-1',
      course: { name: 'Automata', code: 'CMPEN 331' },
    });
    canManageCourseMock.mockResolvedValue(true);

    const solution = await loadViewerProperties('solutions', 'stored.jff', STAFF);
    expect(value(solution!.rows, 'Kind')).toBe("Instructor's solution");

    const problemFile = await loadViewerProperties('problems', 'stored.jff', STAFF);
    expect(value(problemFile!.rows, 'Kind')).toBe('Problem file');
  });

  it('falls back to the email when a student has no name recorded', async () => {
    prismaMock.submission.findFirst.mockResolvedValue({
      ...submission,
      student: { firstName: null, lastName: null, email: 'ada@example.test' },
    });
    canManageCourseMock.mockResolvedValue(true);

    const props = await loadViewerProperties('submissions', 'stored.jff', STAFF);
    expect(value(props!.rows, 'Student')).toBe('ada@example.test');
  });

  it('describes a solution file, and refuses a non-staff reader', async () => {
    prismaMock.problem.findFirst.mockResolvedValue({
      title: 'Three consecutive 1s',
      type: 'FA',
      originalFileName: 'solution.jff',
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-02-03T00:00:00Z'),
      courseId: 'course-1',
      course: { name: 'Automata', code: 'CMPEN 331' },
    });

    canManageCourseMock.mockResolvedValue(true);
    const props = await loadViewerProperties('solutions', 'stored.jff', STAFF);
    expect(value(props!.rows, 'Problem')).toBe('Three consecutive 1s');
    expect(value(props!.rows, 'Added')).toContain('2026-01-02');

    // A solution is the answer key. A student must never reach it, even as metadata.
    canManageCourseMock.mockResolvedValue(false);
    expect(await loadViewerProperties('solutions', 'stored.jff', OWNER)).toBeNull();
  });
});
