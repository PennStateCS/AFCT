/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SubmissionsClient from './SubmissionsClient';

// Fresh QueryClient per test (retry off, no lingering cache) so the submissions
// query starts clean each time.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: toastMock }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
}));

vi.mock('@/lib/useEmptyStringSymbol', () => ({
  useEmptyStringSymbol: () => 'ε',
}));

// Replace the multi-select dropdowns with a trivial stub so their internal
// Radix machinery does not interfere with the selection chain under test. The
// component drives its own selection via effects, so the stub needs no behavior.
vi.mock('@/components/ui/SearchableMultiSelect', () => ({
  SearchableMultiSelect: ({ label }: { label?: string }) => (
    <div data-testid={`multiselect-${label ?? 'unlabeled'}`} />
  ),
}));

vi.mock('@/components/JffViewerDialog', () => ({
  default: () => <div data-testid="jff-viewer" />,
}));

vi.mock('@/components/dialogs/FeedbackDialog', () => ({
  FeedbackDialog: () => <div data-testid="feedback-dialog" />,
}));

// Endpoint payloads for the selection chain.
const COURSES = [{ id: 'course-1', name: 'Automata Theory', code: 'CS500' }];

const ASSIGNMENTS = [
  {
    id: 'assign-1',
    title: 'Assignment One',
    dueDate: '2026-02-01T00:00:00.000Z',
    problems: [{ problemId: 'prob-1', maxPoints: 10 }],
  },
];

const PROBLEMS = [
  {
    id: 'prob-1',
    title: 'Problem One',
    description: null,
    type: 'DFA',
    maxPoints: 10,
    maxStates: null,
    isDeterministic: true,
    solved: false,
    grade: null,
  },
];

const SUBMISSIONS = [
  {
    id: 'sub-1',
    studentId: 'student-1',
    courseId: 'course-1',
    assignmentId: 'assign-1',
    problemId: 'prob-1',
    studentFirstName: 'Ada',
    studentLastName: 'Lovelace',
    studentEmail: 'ada@example.com',
    courseName: 'Automata Theory',
    assignmentTitle: 'Assignment One',
    submittedAt: '2026-01-15T00:00:00.000Z',
    status: 'graded',
    grade: 8,
    correct: true,
    maxPoints: 10,
    problemTitle: 'Problem One',
    avatar: null,
    fileName: 'sub-1.jff',
    originalFileName: 'sub-1.jff',
    feedback: 'Nice work',
  },
];

const jsonResponse = (data: unknown) => ({ ok: true, json: async () => data });

type FetchMock = ReturnType<typeof vi.fn>;

// Route each request by URL (and method) to the matching payload. This lets the
// component's fetch-courses -> fetch-assignments -> fetch-problems -> POST
// submissions cascade run to completion without guessing which call is next.
const installFetchRouter = (
  submissions: unknown = SUBMISSIONS,
  onSubmissionsCall?: (init?: RequestInit) => void,
) => {
  const fetchMock = global.fetch as FetchMock;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/courses/list') return jsonResponse(COURSES);
    if (url === '/api/courses/course-1/assignments') return jsonResponse(ASSIGNMENTS);
    if (url === '/api/assignments/assign-1/problems') return jsonResponse(PROBLEMS);
    if (url === '/api/admin/submissions' && init?.method === 'POST') {
      onSubmissionsCall?.(init);
      return jsonResponse(submissions);
    }
    throw new Error(`Unexpected fetch: ${String(url)}`);
  });
  return fetchMock;
};

const submissionsPostCalls = (fetchMock: FetchMock) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => url === '/api/admin/submissions' && (init as RequestInit | undefined)?.method === 'POST',
  );

describe('SubmissionsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    // SubmissionsClient.tsx does not import React, and the test transform uses
    // the classic JSX runtime, so its compiled `React.createElement` calls
    // resolve `React` from the global scope. Provide it without touching the
    // component. (This test file itself uses the same classic transform.)
    vi.stubGlobal('React', React);
  });

  it('renders the idle empty state without POSTing submissions before anything is selected', async () => {
    // Courses endpoint never resolves, so no course is selected and the chain
    // never reaches the submissions POST.
    const fetchMock = global.fetch as FetchMock;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/courses/list') return new Promise(() => {}); // pending forever
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    renderWithClient(<SubmissionsClient />);

    // Nothing selected -> fetchSubmissions short-circuits to [] with no network call.
    await waitFor(() => {
      expect(screen.getByText('Loading submissions...')).toBeInTheDocument();
    });
    expect(submissionsPostCalls(fetchMock)).toHaveLength(0);
  });

  it('drives the selection chain and POSTs the selected problemIds, rendering the returned rows', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = installFetchRouter(SUBMISSIONS, (init) => {
      capturedInit = init;
    });

    renderWithClient(<SubmissionsClient />);

    // The submitted student row renders once the cascade completes.
    await waitFor(() => {
      expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    });

    const posts = submissionsPostCalls(fetchMock);
    expect(posts.length).toBeGreaterThanOrEqual(1);

    // The final POST carries the auto-selected problem ids as JSON.
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    const body = JSON.parse(String(capturedInit?.body));
    expect(body).toEqual({ problemIds: ['prob-1'] });
  });

  it('shows the loading text while the submissions query is in flight', async () => {
    let releaseSubmissions: (() => void) | undefined;
    const submissionsGate = new Promise<void>((resolve) => {
      releaseSubmissions = resolve;
    });

    const fetchMock = global.fetch as FetchMock;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/courses/list') return jsonResponse(COURSES);
      if (url === '/api/courses/course-1/assignments') return jsonResponse(ASSIGNMENTS);
      if (url === '/api/assignments/assign-1/problems') return jsonResponse(PROBLEMS);
      if (url === '/api/admin/submissions' && init?.method === 'POST') {
        await submissionsGate; // hold the query in flight
        return jsonResponse(SUBMISSIONS);
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    renderWithClient(<SubmissionsClient />);

    // While the POST is pending, the table shows the loading placeholder.
    await waitFor(() => {
      expect(submissionsPostCalls(fetchMock).length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText('Loading submissions...')).toBeInTheDocument();

    // Releasing the POST lets the row render.
    releaseSubmissions?.();
    await waitFor(() => {
      expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    });
  });
});
