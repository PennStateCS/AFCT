/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StudentNavigator, { type StudentNavigatorProps } from './StudentNavigator';

// Render with a fresh QueryClient per test (retry off, no lingering cache) so the
// assignment query starts clean each time.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

// The timezone hook and the date formatter are external concerns; stub them so the
// rendered Due value is deterministic and independent of the host timezone.
vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

vi.mock('@/lib/date', () => ({
  formatDateTimeInTimeZone: (value: string | Date) => `formatted:${String(value)}`,
}));

const baseProps: StudentNavigatorProps = {
  students: [{ id: 's1', firstName: 'Ada', lastName: 'Lovelace' }],
  selectedIndex: 0,
  onSelectStudent: vi.fn(),
  onPrev: vi.fn(),
  onNext: vi.fn(),
  courseId: 'c1',
  assignmentId: 'a1',
};

describe('StudentNavigator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches the assignment on mount and renders a value from the response', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        dueDate: '2026-01-10T00:00:00.000Z',
        allowLateSubmissions: true,
        lateCutoff: '2026-01-12T00:00:00.000Z',
      }),
    });

    renderWithClient(<StudentNavigator {...baseProps} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/assignments/a1?view=problems');
    });

    // Derived from the response: allowLateSubmissions -> "Yes", and the formatted
    // due date comes through the stubbed formatter.
    await waitFor(() => {
      expect(screen.getByText('Yes')).toBeInTheDocument();
      expect(
        screen.getByText('formatted:2026-01-10T00:00:00.000Z'),
      ).toBeInTheDocument();
    });
  });

  it('shows the loading label while the query is in flight', () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    // Never resolves -> query stays pending.
    fetchMock.mockReturnValue(new Promise(() => {}));

    renderWithClient(<StudentNavigator {...baseProps} />);

    expect(screen.getByText('Loading assignment...')).toBeInTheDocument();
  });

  it('renders no assignment detail when the fetch fails', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });

    renderWithClient(<StudentNavigator {...baseProps} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/assignments/a1?view=problems');
    });

    // On error the component renders no assignment block and no loading label.
    await waitFor(() => {
      expect(screen.queryByText('Loading assignment...')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Due:')).not.toBeInTheDocument();
    // The student picker (unrelated UI) still renders, now with its "N of M" position.
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
  });
});
