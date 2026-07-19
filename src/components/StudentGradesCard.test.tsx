/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StudentGradesCard } from './StudentGradesCard';

// Render with a fresh QueryClient per test (retry off, no lingering cache) so the
// grades query starts clean each time.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

// The real collapsible UI component references React without importing it, which
// fails under the test JSX transform; stub it to plain elements.
vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children?: React.ReactNode; asChild?: boolean }) => (
    <>{children}</>
  ),
  CollapsibleContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const gradesResponse = {
  assignments: [
    {
      id: 'a1',
      title: 'Regular Languages',
      description: null,
      dueDate: null,
      maxPoints: 10,
      grade: 8,
      problems: [
        {
          id: 'p1',
          title: 'DFA Design',
          maxPoints: 5,
          maxSubmissions: 3,
          submissionCount: 1,
          grade: 4,
          status: 'COMPLETED',
          autograderEnabled: true,
        },
      ],
    },
  ],
};

describe('StudentGradesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches student grades on mount and renders the response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => gradesResponse,
    });

    renderWithClient(<StudentGradesCard courseId="c1" />);

    await waitFor(() => {
      expect(screen.getByText('Regular Languages')).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/courses/c1/student-grades');
    // Grade summary derived from the response.
    expect(screen.getByText('8/10')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('1 Problems')).toBeInTheDocument();
  });

  it('shows a loading state while the query is pending', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    renderWithClient(<StudentGradesCard courseId="c1" />);

    expect(screen.getByText('Loading grades...')).toBeInTheDocument();
  });

  it('surfaces an error message when the fetch fails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Nope' }),
    });

    renderWithClient(<StudentGradesCard courseId="c1" />);

    await waitFor(() => {
      expect(screen.getByText('Nope')).toBeInTheDocument();
    });
  });
});
