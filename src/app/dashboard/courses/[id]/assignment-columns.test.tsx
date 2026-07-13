/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MaxPointsCell } from './assignment-columns';

// Fresh QueryClient per test (retry off, no lingering cache) so each render starts
// with a cold assignment.shell cache entry.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

describe('MaxPointsCell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders the row value without fetching when maxPoints is known', () => {
    renderWithClient(<MaxPointsCell courseId="c1" assignmentId="a1" maxPoints={42} />);

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches the course assignment and renders the fetched value when maxPoints is null', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ maxPoints: 17 }),
    });

    renderWithClient(<MaxPointsCell courseId="c1" assignmentId="a1" maxPoints={null} />);

    // Loading placeholder before the query resolves.
    expect(screen.getByText('...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('17')).toBeInTheDocument();
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/courses/c1/assignments/a1?view=problems');
  });
});
