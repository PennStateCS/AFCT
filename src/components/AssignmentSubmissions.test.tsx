// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AssignmentSubmissions from './AssignmentSubmissions';

const { replaceMock, toastErrorMock, toastSuccessMock, searchParamsState } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  searchParamsState: {
    params: new URLSearchParams(),
  },
}));

const setSearchParams = (params: Record<string, string>) => {
  searchParamsState.params = new URLSearchParams(params);
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => ({
    get: (key: string) => searchParamsState.params.get(key),
    toString: () => searchParamsState.params.toString(),
  }),
}));

vi.mock('@/lib/toast', () => ({
  showToast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

vi.mock('./WorkspacePanel', () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section data-testid="workspace-panel">
      <h3>{title}</h3>
      {children}
    </section>
  ),
}));

vi.mock('@/components/assignments/ProblemListCard', () => ({
  ProblemListCard: ({
    problems,
    onSelect,
    getBadgeContent,
  }: {
    problems: Array<{ id: string; title: string }>;
    onSelect: (problemId: string) => void;
    getBadgeContent: (problemId: string) => React.ReactNode;
  }) => (
    <div data-testid="problem-list-card">
      {problems.map((problem) => (
        <div key={problem.id}>
          <button onClick={() => onSelect(problem.id)} type="button">
            {problem.title}
          </button>
          <div>{getBadgeContent(problem.id)}</div>
        </div>
      ))}
    </div>
  ),
}));

vi.mock('./ProblemDiscussionPanel', () => ({
  default: ({
    comments,
    commentText,
    onCommentTextChange,
    onSaveComment,
    onDeleteComment,
  }: {
    comments: Array<{ id: string }>;
    commentText: string;
    onCommentTextChange: (text: string) => void;
    onSaveComment: () => void;
    onDeleteComment: (id: string) => void;
  }) => (
    <div data-testid="problem-discussion-panel">
      <input
        aria-label="comment-input"
        value={commentText}
        onChange={(event) => onCommentTextChange(event.target.value)}
      />
      <button onClick={onSaveComment} type="button">
        Save Comment
      </button>
      <button
        onClick={() => {
          if (comments[0]) onDeleteComment(comments[0].id);
        }}
        type="button"
      >
        Delete Comment
      </button>
    </div>
  ),
}));

vi.mock('./StudentNavigator', () => ({
  default: ({
    students,
    selectedIndex,
    onSelectStudent,
    onPrev,
    onNext,
  }: {
    students: Array<{ id: string }>;
    selectedIndex: number;
    onSelectStudent: (id: string) => void;
    onPrev: () => void;
    onNext: () => void;
  }) => (
    <div data-testid="student-navigator">
      <span>{students[selectedIndex]?.id ?? 'none'}</span>
      <button onClick={onPrev} type="button">
        Prev
      </button>
      <button onClick={onNext} type="button">
        Next
      </button>
      <button
        onClick={() => {
          if (students[1]) onSelectStudent(students[1].id);
        }}
        type="button"
      >
        Pick Second
      </button>
    </div>
  ),
}));

vi.mock('./JffViewerDialog', () => ({
  default: ({ open, title }: { open: boolean; title: string }) =>
    open ? <div data-testid="jff-dialog">{title}</div> : null,
}));

vi.mock('./ProblemHeader', () => ({
  default: ({ title }: { title: string }) => <div data-testid="problem-header">{title}</div>,
}));

vi.mock('./ProblemGradeForm', () => ({
  default: ({
    value,
    onChange,
    onSubmit,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
  }) => (
    <div>
      <input
        aria-label="grade-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button onClick={onSubmit} type="button">
        Save Grade
      </button>
    </div>
  ),
}));

vi.mock('./SubmissionActionsMenu', () => ({
  default: ({
    submission,
    onView,
    onRerun,
  }: {
    submission: { id: string };
    onView: (submission: { id: string }) => void;
    onRerun: (submission: { id: string }) => void;
  }) => (
    <div data-testid="submission-actions-menu">
      <button onClick={() => onView(submission)} type="button">
        View {submission.id}
      </button>
      <button onClick={() => onRerun(submission)} type="button">
        Rerun {submission.id}
      </button>
    </div>
  ),
}));

vi.mock('@/components/assignments/GradeBadge', () => ({
  default: ({ grade }: { grade: number | null }) => (
    <span data-testid="grade-badge">{grade === null ? 'ungraded' : grade}</span>
  ),
}));

vi.mock('@/components/dialogs/RegexViewerDialog', () => ({
  RegexViewerDialog: ({ open, title }: { open: boolean; title: string }) =>
    open ? <div data-testid="regex-dialog">{title}</div> : null,
}));

vi.mock('@/components/dialogs/CfgViewerDialog', () => ({
  CfgViewerDialog: ({ open, title }: { open: boolean; title: string }) =>
    open ? <div data-testid="cfg-dialog">{title}</div> : null,
}));

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

const makeResponse = (data: unknown, status = 200): MockResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
  text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
});

type ProblemSeed = {
  id: string;
  title: string;
  type?: string;
  maxPoints?: number;
};

type InstallOptions = {
  problems?: ProblemSeed[];
  students?: Array<{ id: string; firstName: string; lastName: string }>;
  submissionsByStudent?: Record<string, Record<string, unknown>>;
  comments?: Array<{ id: string; problemId?: string }>;
  gradesByStudent?: Record<
    string,
    Record<string, { grade: number | null; feedback: string | null }>
  >;
  gradeSummary?: Record<string, boolean>;
  rerunFailureIds?: string[];
  studentFetchStatus?: number;
  groupMembersByGroupId?: Record<string, Array<{ userId: string }>>;
};

const installFetchMock = (options: InstallOptions = {}) => {
  const {
    problems = [],
    students = [{ id: 'student-1', firstName: 'Ada', lastName: 'Lovelace' }],
    submissionsByStudent = { 'student-1': {} },
    comments = [],
    gradesByStudent = { 'student-1': {} },
    gradeSummary = {},
    rerunFailureIds = [],
    studentFetchStatus = 200,
    groupMembersByGroupId = {},
  } = options;

  let commentList = [...comments];

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = url.split('?')[0];

    if (url.includes('/api/courses/course-1/students')) {
      return makeResponse(students, studentFetchStatus);
    }

    if (url.includes('/api/courses/course-1/problems')) return makeResponse(problems);

    if (url.includes('/api/courses/course-1/assignment-1/problem-grades/summary')) {
      return makeResponse(gradeSummary);
    }

    const submissionsMatch = path.match(
      /\/api\/courses\/course-1\/assignment-1\/submissions\/(.+)$/,
    );
    if (submissionsMatch) {
      const studentId = decodeURIComponent(submissionsMatch[1]);
      return makeResponse(submissionsByStudent[studentId] ?? {});
    }

    const gradesMatch = path.match(/\/api\/courses\/course-1\/assignment-1\/problem-grades\/(.+)$/);
    if (gradesMatch) {
      const studentId = decodeURIComponent(gradesMatch[1]);
      return makeResponse(gradesByStudent[studentId] ?? {});
    }

    if (url.includes('/api/comments?') && !url.includes('commentId=')) {
      return makeResponse(commentList);
    }

    if (path.endsWith('/api/comments') && !url.includes('commentId=')) {
      const newComment = { id: 'new-comment-id' };
      commentList = [...commentList, newComment];
      return makeResponse(newComment);
    }

    const deleteCommentMatch = url.match(/\/api\/comments\?commentId=(.+)$/);
    if (deleteCommentMatch) {
      const commentId = decodeURIComponent(deleteCommentMatch[1]);
      commentList = commentList.filter((comment) => comment.id !== commentId);
      return makeResponse({});
    }

    const rerunMatch = path.match(/\/api\/submissions\/(.+)\/rerun$/);
    if (rerunMatch) {
      const submissionId = decodeURIComponent(rerunMatch[1]);
      if (rerunFailureIds.includes(submissionId)) {
        return makeResponse({ error: 'Failed to rerun submission' }, 500);
      }
      return makeResponse({});
    }

    const saveGradeMatch = path.match(
      /\/api\/courses\/course-1\/assignment-1\/problems\/.+\/grade\/.+$/,
    );
    if (saveGradeMatch) {
      return makeResponse({});
    }

    const groupMembersMatch = path.match(/\/api\/courses\/course-1\/groups\/(.+)\/members$/);
    if (groupMembersMatch) {
      const groupId = decodeURIComponent(groupMembersMatch[1]);
      return makeResponse({ members: groupMembersByGroupId[groupId] ?? [] });
    }

    return makeResponse({});
  });

  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  return fetchMock;
};

describe('AssignmentSubmissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSearchParams({});
  });

  it('renders empty-state when there are no problems', async () => {
    const fetchMock = installFetchMock({ problems: [] });

    render(
      <AssignmentSubmissions
        courseIsArchived={false}
        courseId="course-1"
        assignmentId="assignment-1"
        maxAssignmentGrade={100}
        problems={[]}
      />,
    );

    expect(
      await screen.findByText('No problems have been added to this assignment yet.'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('shows no submissions message when selected problem has none', async () => {
    installFetchMock({
      problems: [{ id: 'problem-1', title: 'Deterministic FA', type: 'FA', maxPoints: 100 }],
      submissionsByStudent: { 'student-1': { 'problem-1': [] } },
    });

    render(
      <AssignmentSubmissions
        courseIsArchived={false}
        courseId="course-1"
        assignmentId="assignment-1"
        maxAssignmentGrade={100}
        problems={[{ id: 'problem-1', title: 'Deterministic FA', type: 'FA', maxPoints: 100 }]}
      />,
    );

    expect(await screen.findByText('No submissions yet.')).toBeInTheDocument();
    expect(screen.getByTestId('student-navigator')).toBeInTheDocument();
    expect(screen.getByTestId('problem-list-card')).toBeInTheDocument();
    expect(screen.getByTestId('problem-discussion-panel')).toBeInTheDocument();
    expect(screen.getByTestId('problem-header')).toHaveTextContent('Deterministic FA');
  });

  it('handles student fetch failure by showing toast and rendering no student view', async () => {
    installFetchMock({
      problems: [{ id: 'problem-1', title: 'P1' }],
      studentFetchStatus: 500,
    });

    render(
      <AssignmentSubmissions
        courseIsArchived={false}
        courseId="course-1"
        assignmentId="assignment-1"
        maxAssignmentGrade={100}
        problems={[{ id: 'problem-1', title: 'P1' }]}
      />,
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Failed to load students');
    });

    expect(screen.queryByText('Submissions')).not.toBeInTheDocument();
  });

  it('saves and deletes comments and reruns a submission', async () => {
    installFetchMock({
      problems: [{ id: 'problem-1', title: 'Problem 1', type: 'FA', maxPoints: 100 }],
      submissionsByStudent: {
        'student-1': {
          'problem-1': [
            {
              id: 'sub-1',
              submittedAt: '2026-03-01T10:00:00.000Z',
              correct: null,
              feedback: null,
              fileName: 'sub-1.jff',
              originalFileName: 'sub-1.jff',
            },
          ],
        },
      },
      comments: [{ id: 'comment-1', problemId: 'problem-1' }],
      gradesByStudent: { 'student-1': { 'problem-1': { grade: 20, feedback: null } } },
    });

    render(
      <AssignmentSubmissions
        courseIsArchived={false}
        courseId="course-1"
        assignmentId="assignment-1"
        maxAssignmentGrade={100}
        problems={[{ id: 'problem-1', title: 'Problem 1', type: 'FA', maxPoints: 100 }]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('No feedback')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('comment-input'), { target: { value: 'Nice work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Comment' }));

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('Comment saved successfully');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete Comment' }));
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('Comment deleted successfully');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Rerun sub-1' }));
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('Submission re-evaluated');
    });
  });

  it('validates grade input and blocks editing when archived', async () => {
    installFetchMock({
      problems: [{ id: 'problem-1', title: 'Problem 1', maxPoints: 30 }],
      submissionsByStudent: { 'student-1': { 'problem-1': [] } },
      gradesByStudent: { 'student-1': { 'problem-1': { grade: null, feedback: null } } },
    });

    render(
      <AssignmentSubmissions
        courseIsArchived={true}
        courseId="course-1"
        assignmentId="assignment-1"
        maxAssignmentGrade={100}
        problems={[{ id: 'problem-1', title: 'Problem 1', maxPoints: 30 }]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('grade-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('grade-input'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Course is archived; grades cannot be edited.');
    });
  });

  it('saves valid grade and syncs query params for selected student/problem', async () => {
    setSearchParams({ studentId: 'student-1' });
    installFetchMock({
      students: [
        { id: 'student-2', firstName: 'Grace', lastName: 'Hopper' },
        { id: 'student-1', firstName: 'Ada', lastName: 'Lovelace' },
      ],
      problems: [{ id: 'problem-1', title: 'Problem 1', maxPoints: 30 }],
      submissionsByStudent: { 'student-1': { 'problem-1': [] } },
      gradesByStudent: { 'student-1': { 'problem-1': { grade: 10, feedback: null } } },
    });

    render(
      <AssignmentSubmissions
        courseIsArchived={false}
        courseId="course-1"
        assignmentId="assignment-1"
        maxAssignmentGrade={100}
        problems={[{ id: 'problem-1', title: 'Problem 1', maxPoints: 30 }]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('student-navigator')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('grade-input'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith(
        expect.stringContaining('Grade 25 saved for Ada Lovelace on Problem 1'),
      );
    });

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalled();
    });
  });

  it('opens viewer dialogs for FA, RE, and CFG problem types', async () => {
    const baseSubmission = {
      id: 'sub-1',
      submittedAt: '2026-03-01T10:00:00.000Z',
      correct: null,
      feedback: null,
      fileName: 'file.txt',
      originalFileName: 'file.txt',
    };

    const runForType = async (type: 'FA' | 'RE' | 'CFG') => {
      installFetchMock({
        problems: [{ id: 'problem-1', title: `${type} Problem`, type, maxPoints: 100 }],
        submissionsByStudent: { 'student-1': { 'problem-1': [baseSubmission] } },
      });

      const { unmount } = render(
        <AssignmentSubmissions
          courseIsArchived={false}
          courseId="course-1"
          assignmentId="assignment-1"
          maxAssignmentGrade={100}
          problems={[{ id: 'problem-1', title: `${type} Problem`, type, maxPoints: 100 }]}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'View sub-1' })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'View sub-1' }));

      if (type === 'FA') {
        expect(screen.getByTestId('jff-dialog')).toBeInTheDocument();
      }
      if (type === 'RE') {
        expect(screen.getByTestId('regex-dialog')).toBeInTheDocument();
      }
      if (type === 'CFG') {
        expect(screen.getByTestId('cfg-dialog')).toBeInTheDocument();
      }
      unmount();
    };

    await runForType('FA');
    await runForType('RE');
    await runForType('CFG');
  });

  it('filters visible problems for group assignments based on membership', async () => {
    installFetchMock({
      problems: [
        { id: 'p-assignment', title: 'General Problem' },
        { id: 'p-group-1', title: 'Group 1 Problem' },
        { id: 'p-group-2', title: 'Group 2 Problem' },
      ],
      submissionsByStudent: {
        'student-1': {
          'p-assignment': [],
          'p-group-1': [],
          'p-group-2': [],
        },
      },
      groupMembersByGroupId: {
        'group-1': [{ userId: 'student-1' }],
        'group-2': [],
      },
    });

    render(
      <AssignmentSubmissions
        courseIsArchived={false}
        courseId="course-1"
        assignmentId="assignment-1"
        maxAssignmentGrade={100}
        assignmentIsGroup={true}
        groups={[
          { id: 'group-1', name: 'Group 1' },
          { id: 'group-2', name: 'Group 2' },
        ]}
        groupProblemsMap={{
          'group-1': ['p-group-1'],
          'group-2': ['p-group-2'],
        }}
        problems={[
          { id: 'p-assignment', title: 'General Problem', maxPoints: 50 },
          { id: 'p-group-1', title: 'Group 1 Problem', maxPoints: 50 },
          { id: 'p-group-2', title: 'Group 2 Problem', maxPoints: 50 },
        ]}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Problem 1: General Problem' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Problem 2: Group 1 Problem' }),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByRole('button', { name: 'Problem 3: Group 2 Problem' }),
    ).not.toBeInTheDocument();
  });
});
