import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attemptPointsFor,
  fetchAssignmentsForCourse,
  fetchAssignmentsForCourses,
  fetchCourseList,
  fetchProblemsForAssignment,
  fetchProblemsForAssignments,
  fetchSubmissions,
  formatStudentName,
  type SubmissionItem,
  type SubmissionsQuery,
} from './submissions-data';

/**
 * These fetchers used to live inside `SubmissionsClient`, where the only way to reach them was
 * to render the page. Their failure branches were consequently untested, and they do not all
 * fail the same way: the course list throws, and the two picker lists return empty. That
 * difference is deliberate and is what most of this file pins down.
 */

const fetchMock = vi.fn();

/** A `fetch` response with just the surface these functions touch. */
const ok = (body: unknown) => ({ ok: true, json: async () => body });
const notOk = (status = 500) => ({ ok: false, status, json: async () => ({}) });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('formatStudentName', () => {
  it('reads surname first, the way a roster does', () => {
    expect(formatStudentName({ studentFirstName: 'Ada', studentLastName: 'Lovelace' })).toBe(
      'Lovelace, Ada',
    );
  });

  it('returns one name on its own rather than leaving a dangling comma', () => {
    expect(formatStudentName({ studentLastName: 'Lovelace' })).toBe('Lovelace');
    expect(formatStudentName({ studentFirstName: 'Ada' })).toBe('Ada');
  });

  it('ignores whitespace-only names', () => {
    expect(formatStudentName({ studentFirstName: '  ', studentLastName: '  ' })).toBeNull();
  });

  it('returns null when neither name is recorded', () => {
    expect(formatStudentName({})).toBeNull();
    expect(formatStudentName({ studentFirstName: null, studentLastName: null })).toBeNull();
  });
});

describe('attemptPointsFor', () => {
  const attempt = (over: Partial<SubmissionItem>) => over as SubmissionItem;

  it('awards the problem’s full points for a correct attempt', () => {
    expect(attemptPointsFor(attempt({ correct: true, maxPoints: 10 }))).toBe(10);
  });

  it('awards zero for an incorrect attempt', () => {
    expect(attemptPointsFor(attempt({ correct: false, maxPoints: 10 }))).toBe(0);
  });

  /** Not zero: an ungraded attempt has no score yet, and showing 0 would read as a fail. */
  it('reports no score at all while the attempt is ungraded', () => {
    expect(attemptPointsFor(attempt({ correct: null, maxPoints: 10 }))).toBeNull();
    expect(attemptPointsFor(attempt({ maxPoints: 10 }))).toBeNull();
  });

  it('treats a correct attempt on a problem with no points as zero', () => {
    expect(attemptPointsFor(attempt({ correct: true, maxPoints: null }))).toBe(0);
  });
});

describe('fetchCourseList', () => {
  it('returns the courses the viewer may see', async () => {
    fetchMock.mockResolvedValue(ok([{ id: 'c1', name: 'Theory', code: 'CS300' }]));

    await expect(fetchCourseList()).resolves.toEqual([
      { id: 'c1', name: 'Theory', code: 'CS300' },
    ]);
  });

  /**
   * The one list that throws. An admin who cannot load their own course list is looking at a
   * broken page, and react-query needs the rejection to show the error state rather than an
   * empty picker that looks like "you teach nothing".
   */
  it('throws when the request fails', async () => {
    fetchMock.mockResolvedValue(notOk());

    await expect(fetchCourseList()).rejects.toThrow('Failed to load courses');
  });
});

describe('fetchAssignmentsForCourse', () => {
  it('tags each assignment with the course it came from', async () => {
    fetchMock.mockResolvedValue(
      ok([{ id: 'a1', title: 'HW1', dueDate: '2026-01-01T00:00:00.000Z', problems: [] }]),
    );

    const [assignment] = await fetchAssignmentsForCourse('c1');

    // The id is not on the payload; it is the argument. Without it the picker cannot tell
    // which course an assignment belongs to once several are selected.
    expect(assignment.courseId).toBe('c1');
    expect(assignment.title).toBe('HW1');
  });

  it('flattens the problem list to ids', async () => {
    fetchMock.mockResolvedValue(
      ok([
        {
          id: 'a1',
          title: 'HW1',
          problems: [
            { problemId: 'p1', maxPoints: 5 },
            { problemId: 'p2', maxPoints: 5 },
          ],
        },
      ]),
    );

    expect((await fetchAssignmentsForCourse('c1'))[0].problems).toEqual(['p1', 'p2']);
  });

  /**
   * Empty, not a throw. One course the viewer cannot read should narrow the picker rather than
   * break the cascade for the courses that did answer, since these run fanned out together.
   */
  it('returns nothing when the course cannot be read', async () => {
    fetchMock.mockResolvedValue(notOk(403));

    await expect(fetchAssignmentsForCourse('c1')).resolves.toEqual([]);
  });

  it('copes with an assignment carrying no problems field', async () => {
    fetchMock.mockResolvedValue(ok([{ id: 'a1', title: 'HW1' }]));

    expect((await fetchAssignmentsForCourse('c1'))[0].problems).toEqual([]);
  });

  it('copes with a problems field that is not a list', async () => {
    fetchMock.mockResolvedValue(ok([{ id: 'a1', title: 'HW1', problems: null }]));

    expect((await fetchAssignmentsForCourse('c1'))[0].problems).toEqual([]);
  });
});

describe('fetchProblemsForAssignment', () => {
  const problem = {
    id: 'p1',
    title: 'Even length',
    description: null,
    type: 'FA',
    maxPoints: 10,
    maxStates: null,
    isDeterministic: true,
    solved: false,
    grade: null,
  };

  it('returns the problems on the assignment', async () => {
    fetchMock.mockResolvedValue(ok([problem]));

    await expect(fetchProblemsForAssignment('a1')).resolves.toEqual([problem]);
  });

  it('returns nothing when the assignment cannot be read', async () => {
    fetchMock.mockResolvedValue(notOk(404));

    await expect(fetchProblemsForAssignment('a1')).resolves.toEqual([]);
  });
});

describe('fanning out across a selection', () => {
  it('asks once per course and concatenates the answers', async () => {
    fetchMock
      .mockResolvedValueOnce(ok([{ id: 'a1', title: 'HW1' }]))
      .mockResolvedValueOnce(ok([{ id: 'a2', title: 'HW2' }]));

    const assignments = await fetchAssignmentsForCourses(['c1', 'c2']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(assignments.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(assignments.map((a) => a.courseId)).toEqual(['c1', 'c2']);
  });

  /** One unreadable course must not cost the others their assignments. */
  it('keeps the courses that answered when one fails', async () => {
    fetchMock
      .mockResolvedValueOnce(notOk(403))
      .mockResolvedValueOnce(ok([{ id: 'a2', title: 'HW2' }]));

    expect((await fetchAssignmentsForCourses(['c1', 'c2'])).map((a) => a.id)).toEqual(['a2']);
  });

  it('asks nothing when nothing is selected', async () => {
    await expect(fetchAssignmentsForCourses([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * The dedupe that matters: a problem can be attached to more than one assignment, and
   * selecting both used to offer it twice in the picker.
   */
  it('lists a problem once even when two assignments share it', async () => {
    const shared = { id: 'p1', title: 'Even length' };
    fetchMock.mockResolvedValueOnce(ok([shared])).mockResolvedValueOnce(ok([shared]));

    const problems = await fetchProblemsForAssignments(['a1', 'a2']);

    expect(problems.map((p) => p.id)).toEqual(['p1']);
  });

  it('preserves distinct problems across assignments', async () => {
    fetchMock
      .mockResolvedValueOnce(ok([{ id: 'p1', title: 'One' }]))
      .mockResolvedValueOnce(ok([{ id: 'p2', title: 'Two' }]));

    expect((await fetchProblemsForAssignments(['a1', 'a2'])).map((p) => p.id)).toEqual([
      'p1',
      'p2',
    ]);
  });
});

describe('fetchSubmissions', () => {
  const query: SubmissionsQuery = {
    courseIds: ['c1'],
    assignmentIds: [],
    problemIds: [],
    field: 'all',
    timing: [],
    status: [],
    page: 1,
    pageSize: 10,
    sortDir: 'desc',
  };

  it('posts the query and returns the page', async () => {
    fetchMock.mockResolvedValue(ok({ rows: [{ id: 's1' }], total: 1 }));

    const page = await fetchSubmissions(query);

    expect(page.total).toBe(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(query);
  });

  /**
   * A page of grades must never be served from the browser cache: a regrade or a rerun has to
   * be visible on the next load, not whenever the cache decides.
   */
  it('does not let the browser cache a page of grades', async () => {
    fetchMock.mockResolvedValue(ok({ rows: [], total: 0 }));

    await fetchSubmissions(query);

    expect(fetchMock.mock.calls[0][1].cache).toBe('no-store');
  });

  it('throws when the page cannot be loaded', async () => {
    fetchMock.mockResolvedValue(notOk());

    await expect(fetchSubmissions(query)).rejects.toThrow('Failed to load submissions');
  });
});
