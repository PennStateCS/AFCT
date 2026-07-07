/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SystemStatusClient from './SystemStatusClient';

// Render with a fresh QueryClient per test (retry off, no lingering cache) so the
// status query starts clean each time.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

// The component reads `status.system.hostname` (Network card) and
// `status.database.message` (Database Overview card) on its main render path.
// Provide only the fields those paths touch; cast to the giant StatusResponse
// type to avoid filling in everything.
const makeStatus = (overrides: Record<string, unknown> = {}) =>
  ({
    system: {
      hostname: 'test-host-01',
      nodeVersion: 'v20.11.0',
      arch: 'x64',
    },
    database: {
      ok: true,
      message: 'Database reachable',
    },
    metrics: { provider: 'postgres', latencyMs: 5 },
    ...overrides,
  }) as unknown;

const mockFetchResolves = () =>
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => makeStatus(),
  });

describe('SystemStatusClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches /api/admin/status on mount and renders a field from the response', async () => {
    mockFetchResolves();

    renderWithClient(<SystemStatusClient />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/admin/status', { cache: 'no-store' });
    });

    expect(await screen.findByText('test-host-01')).toBeInTheDocument();
    expect(screen.getByText('Database reachable')).toBeInTheDocument();
  });

  it('shows a loading indicator before the fetch resolves', () => {
    // Fetch never resolves so the loading state persists.
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    renderWithClient(<SystemStatusClient />);

    // While loading, the Refresh button label switches to "Refreshing…".
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeInTheDocument();
  });

  it('re-fetches when the Refresh button is clicked', async () => {
    mockFetchResolves();

    renderWithClient(<SystemStatusClient />);

    // Wait until the initial fetch settles and the button returns to its idle
    // "Refresh" label (it reads "Refreshing…" while loading/fetching).
    const refreshButton = await screen.findByRole('button', { name: 'Refresh' });

    const callsAfterMount = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
        callsAfterMount,
      );
    });

    expect(global.fetch).toHaveBeenLastCalledWith('/api/admin/status', { cache: 'no-store' });
  });

  it('requests the deep URL when the deep toggle is enabled', async () => {
    mockFetchResolves();

    renderWithClient(<SystemStatusClient />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/admin/status', { cache: 'no-store' });
    });

    // The deep control is a Radix Switch exposing role="switch" with this label.
    fireEvent.click(screen.getByRole('switch', { name: 'Enable deep health checks' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/admin/status?deep=1', { cache: 'no-store' });
    });
  });
});
