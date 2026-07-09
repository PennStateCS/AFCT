/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SystemStatusClient from './SystemStatusClient';

const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

const summary = {
  db: { ok: true, message: 'reachable', provider: 'postgres' },
  uptime: 3600,
  procCpuPct: 12,
  procMemPct: 3.5,
  dbTables: 42,
  dbSizeBytes: 1024 * 1024,
  sessions24h: 7,
  uniqueUsers24h: 3,
  latencyMs: 5,
};
const server = {
  system: { arch: 'x64', cpuCount: 8, hostname: 'test-host-01', ipAddresses: [] },
  software: { nodeVersion: 'v20.11.0', nextVersion: '15.0.0' },
};
const filesPayload = {
  abandonedFiles: {
    total: 1,
    byCategory: { solutions: 1, submissions: 0, pfps: 0, problems: 0 },
    samples: [{ category: 'solutions', fileName: 'orphan.jff', path: '/uploads/orphan.jff' }],
  },
};

// Route global fetch by URL/method (fetchJson reads res.ok + res.json()).
const routeFetch = () =>
  (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
    (url: string, init?: RequestInit) => {
      const u = String(url);
      const json = (data: unknown) =>
        Promise.resolve({ ok: true, json: async () => data } as Response);
      if (u.includes('/status/summary')) return json(summary);
      if (u.includes('/status/server')) return json(server);
      if (u.includes('/status/files') && init?.method === 'DELETE') return json({ ok: true });
      if (u.includes('/status/files')) return json(filesPayload);
      if (u.includes('/status/database'))
        return json({ ok: true, message: 'reachable', provider: 'postgres' });
      return json({});
    },
  );

describe('SystemStatusClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
    routeFetch();
  });

  it('loads the summary and renders the cards + tab selector', async () => {
    renderWithClient(<SystemStatusClient />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/admin/status/summary'));
    // DB badge + a summary tile from /summary.
    expect(await screen.findByText('DB OK')).toBeInTheDocument();
    expect(screen.getByText('POSTGRES')).toBeInTheDocument();
    // All six tabs present.
    for (const name of ['Server', 'Database', 'Docker', 'Network', 'Session', 'Files']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
  });

  it('loads the Server tab (default) from its own endpoint', async () => {
    renderWithClient(<SystemStatusClient />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/admin/status/server'));
    expect(await screen.findByText('v20.11.0')).toBeInTheDocument();
  });

  it('loads the Files tab from its own endpoint and deletes a file when confirmed', async () => {
    localStorage.setItem('afct.systemStatusTab', 'files');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithClient(<SystemStatusClient />);

    const deleteBtn = await screen.findByRole('button', {
      name: 'Delete abandoned file orphan.jff',
    });
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      const deleted = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(
        ([u, init]) =>
          String(u).includes('/status/files') &&
          (init as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(deleted).toBe(true);
    });
  });

  it('does not fetch the Files endpoint while another tab is open', async () => {
    renderWithClient(<SystemStatusClient />); // default: Server tab
    await screen.findByText('DB OK');
    expect(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([u]) =>
        String(u).includes('/status/files'),
      ),
    ).toBe(false);
  });

  it('shows the Deep toggle on the Database tab', async () => {
    localStorage.setItem('afct.systemStatusTab', 'database');
    renderWithClient(<SystemStatusClient />);

    expect(
      await screen.findByRole('switch', { name: 'Enable deep database probes' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/admin/status/database'));
  });
});
