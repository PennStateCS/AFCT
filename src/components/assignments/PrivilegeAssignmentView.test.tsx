/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AssignmentDashboardPage from './PrivilegeAssignmentView';
import type { AssignmentWithDetails } from '@/lib/assignment-details';

// Render with a fresh QueryClient per test (retry off, no lingering cache) so
// each read query starts clean.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/lib/toast', () => ({
  showToast: { success: toastSuccess, error: toastError },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'c1', aid: 'a1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
}));

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

vi.mock('@/lib/useEmptyStringSymbol', () => ({
  useEmptyStringSymbol: () => '∅',
}));

// Heavy children — stubbed. DataTable renders the titles of the rows it gets so
// we can assert the problems table received the course-problems data.
vi.mock('@/components/AssignmentSubmissions', () => ({ default: () => null }));
vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({ data }: { data: Array<{ id?: string; title?: string }> }) => (
    <ul data-testid="data-table">
      {data.map((row, i) => (
        <li key={row.id ?? i}>{row.title}</li>
      ))}
    </ul>
  ),
}));

// Dialogs are inert stubs — we only exercise the reads, not the dialog flows.
// Render the candidate problems this dialog receives so we can assert the
// course-problems read (Read 1) flows through to it.
vi.mock('@/components/dialogs/AssociateProblemsDialog', () => ({
  AssociateProblemsDialog: ({ allProblems }: { allProblems: Array<{ id: string; title: string }> }) => (
    <ul data-testid="associate-problems">
      {allProblems.map((p) => (
        <li key={p.id}>{p.title}</li>
      ))}
    </ul>
  ),
}));
vi.mock('@/components/dialogs/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/components/dialogs/CfgViewerDialog', () => ({ CfgViewerDialog: () => null }));
vi.mock('@/components/dialogs/RegexViewerDialog', () => ({ RegexViewerDialog: () => null }));
vi.mock('@/components/dialogs/CreateProblemDialog', () => ({ CreateProblemDialog: () => null }));
vi.mock('@/components/dialogs/EditAssignmentDialog', () => ({ EditAssignmentDialog: () => null }));
vi.mock('@/components/dialogs/EditProblemDialog', () => ({ EditProblemDialog: () => null }));
vi.mock('@/components/JffViewerDialog', () => ({ default: () => null }));

const buildAssignment = (overrides: Partial<AssignmentWithDetails> = {}): AssignmentWithDetails =>
  ({
    id: 'a1',
    title: 'Regex Basics',
    courseId: 'c1',
    courseName: 'Automata',
    isPublished: true,
    isGroup: false,
    dueDate: new Date('2026-01-10T00:00:00.000Z'),
    maxPoints: 100,
    allowLateSubmissions: false,
    lateCutoff: null,
    course: { id: 'c1', name: 'Automata', code: 'CS101', isArchived: false },
    problems: [],
    ...overrides,
  }) as unknown as AssignmentWithDetails;

// Simple URL router over fetch so tests only care about the endpoint hit.
type FetchResult = { ok: boolean; json: () => Promise<unknown> };
const routeFetch = (routes: Record<string, () => FetchResult>) =>
  vi.fn((url: string) => {
    const key = Object.keys(routes).find((r) => url.includes(r));
    if (!key) throw new Error(`Unexpected fetch: ${url}`);
    return Promise.resolve(routes[key]());
  });

describe('AssignmentDashboardPage (PrivilegeAssignmentView)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders the seeded assignment title and fetches course problems on the problems tab', async () => {
    const problems = [{ id: 'p1', title: 'Course Problem One', type: 'FA' }];
    const fetchMock = routeFetch({
      'view=problems': () => ({ ok: true, json: async () => ({ problems }) }),
      '/assignments': () => ({ ok: true, json: async () => [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(
      <AssignmentDashboardPage
        initialAssignment={buildAssignment()}
        initialAssignments={[{ id: 'a1', title: 'Regex Basics' }]}
      />,
    );

    // Title comes from the seeded initialAssignment shell (rendered in both the
    // heading and the dropdown value).
    expect(screen.getAllByText('Regex Basics').length).toBeGreaterThan(0);

    // The problems tab is active by default -> GET /api/courses/c1/problems.
    // (This course-problems read feeds the "Add Existing Problem" dialog's
    // candidate list; the visible table renders the assignment's own problems.)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1?view=problems');
    });

    // The fetched course problem flows through to the association dialog's
    // candidate list.
    await waitFor(() => {
      expect(screen.getByText('Course Problem One')).toBeInTheDocument();
    });
  });

  it('seeds the assignment dropdown from initialAssignments with no /assignments fetch on mount', async () => {
    const fetchMock = routeFetch({
      'view=problems': () => ({ ok: true, json: async () => ({ problems: [] }) }),
      '/assignments': () => ({ ok: true, json: async () => [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(
      <AssignmentDashboardPage
        initialAssignment={buildAssignment()}
        initialAssignments={[{ id: 'a1', title: 'Regex Basics' }]}
      />,
    );

    // Let the problems fetch settle so any stray assignments fetch would have fired.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1?view=problems');
    });

    const calledUrls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(calledUrls.some((u) => u.includes('/assignments'))).toBe(false);
  });

  it('fetches groups and group-problem mappings for a group assignment', async () => {
    const fetchMock = routeFetch({
      'view=problems': () => ({ ok: true, json: async () => ({ problems: [] }) }),
      '/assignments': () => ({ ok: true, json: async () => [] }),
      '/groups': () => ({ ok: true, json: async () => ({ groups: [{ id: 'g1', name: 'Team A' }] }) }),
      '/group-problems': () => ({
        ok: true,
        json: async () => ({ groups: [{ id: 'g1', problemIds: ['p1'] }] }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(
      <AssignmentDashboardPage
        initialAssignment={buildAssignment({ isGroup: true } as Partial<AssignmentWithDetails>)}
        initialAssignments={[{ id: 'a1', title: 'Regex Basics' }]}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/groups', expect.anything());
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/a1/group-problems', expect.anything());
    });
    // The list read is now a GET — no POST body.
    const groupProblemsCall = fetchMock.mock.calls.find(
      (c) => (c[0] as string) === '/api/courses/c1/a1/group-problems',
    );
    expect((groupProblemsCall?.[1] as { method?: string } | undefined)?.method).toBeUndefined();
  });
});
