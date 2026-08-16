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
  storage: {
    categories: [
      {
        category: 'submissions',
        label: 'Student submissions',
        inUseCount: 412,
        inUseBytes: 8_400_000,
        abandonedCount: 0,
        abandonedBytes: 0,
        missingCount: 2,
        missingSamples: ['gone.jff', 'also-gone.jff'],
      },
      {
        category: 'solutions',
        label: 'Reference solutions',
        inUseCount: 13,
        inUseBytes: 26_000,
        abandonedCount: 1,
        abandonedBytes: 2048,
        missingCount: 0,
        missingSamples: [],
      },
    ],
    inUseCount: 425,
    inUseBytes: 8_426_000,
    missingCount: 2,
    volume: { totalBytes: 40_000_000_000, freeBytes: 12_000_000_000 },
  },
  abandonedFiles: {
    total: 1,
    totalSizeBytes: 2048,
    listLimit: 500,
    categories: [
      { category: 'solutions', label: 'Reference solutions', count: 1, sizeBytes: 2048 },
      { category: 'submissions', label: 'Student submissions', count: 0, sizeBytes: 0 },
    ],
    files: [
      {
        category: 'solutions',
        fileName: 'orphan.jff',
        path: '/private/uploads/solutions/orphan.jff',
        sizeBytes: 2048,
        modifiedAt: '2026-08-01T12:00:00.000Z',
      },
    ],
  },
};

const NOW = 1_700_000_000_000;
const rateLimits = {
  generatedAt: NOW,
  entries: [
    {
      id: 'login:ip:203.0.113.5',
      ip: '203.0.113.5',
      scope: 'login:ip',
      scopeLabel: 'Sign-in attempts',
      state: 'blocked',
      reason: 'Too many failed sign-in attempts from this address',
      startedAt: NOW - 5 * 60_000,
      expiresAt: NOW + 25 * 60_000,
      attempts: 21,
      attemptsWhileRestricted: 4,
      lastAttemptAt: NOW - 30_000,
      details: {
        version: 4,
        kind: 'public',
        kindLabel: 'Public internet address',
        hostname: 'lab-12.cs.example.edu',
        hostnameLookup: 'ok',
        knownActivity: {
          windowDays: 30,
          eventCount: 482,
          accountCount: 12,
          accounts: ['a@example.edu', 'b@example.edu'],
          firstSeen: NOW - 20 * 24 * 3600_000,
          lastSeen: NOW - 30_000,
          truncated: false,
        },
      },
    },
  ],
};

// Route global fetch by URL/method (fetchJson reads res.ok + res.json()).
const routeFetch = () =>
  (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
    (url: string, init?: RequestInit) => {
      const u = String(url);
      const json = (data: unknown) =>
        Promise.resolve({ ok: true, json: async () => data } as Response);
      if (u.includes('/status/rate-limits/clear')) return json({ success: true });
      if (u.includes('/status/rate-limits')) return json(rateLimits);
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
    // All tabs present.
    for (const name of [
      'Server',
      'Database',
      'Docker',
      'Network',
      'Session',
      'Files',
      'Rate Limits',
    ]) {
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
    renderWithClient(<SystemStatusClient />);

    // The accessible name says what kind of file it is: a bare UUID read aloud tells the
    // person operating this nothing about what they are about to remove.
    const deleteBtn = await screen.findByRole('button', {
      name: 'Delete Reference solutions file orphan.jff',
    });
    fireEvent.click(deleteBtn);

    // Deleting now opens a confirmation dialog; confirm it.
    fireEvent.click(await screen.findByRole('button', { name: 'Delete file' }));

    await waitFor(() => {
      const deleted = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(
        ([u, init]) =>
          String(u).includes('/status/files') &&
          (init as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(deleted).toBe(true);
    });
  });

  it('shows what the uploads volume holds before what can be reclaimed', async () => {
    localStorage.setItem('afct.systemStatusTab', 'files');
    renderWithClient(<SystemStatusClient />);

    // The working set, named for the person operating this rather than by folder.
    expect(await screen.findByText('Student submissions')).toBeInTheDocument();
    expect(await screen.findByText('412')).toBeInTheDocument();
    // Sizes only mean something against what is left on the disk.
    expect(await screen.findByText(/free of/)).toBeInTheDocument();
  });

  it('raises a file AFCT records but cannot find as its own alert', async () => {
    // Everything else on this page is housekeeping; this is work the system believes it has
    // and cannot produce, which for a submission means it cannot be downloaded or re-graded.
    localStorage.setItem('afct.systemStatusTab', 'files');
    renderWithClient(<SystemStatusClient />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('2 files are recorded but not on the server');
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

  it('fetches the database endpoint when the Database tab is open', async () => {
    localStorage.setItem('afct.systemStatusTab', 'database');
    renderWithClient(<SystemStatusClient />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/admin/status/database'));
  });

  it('shows each restricted address with its reason, activity and expiry', async () => {
    localStorage.setItem('afct.systemStatusTab', 'rate-limits');
    renderWithClient(<SystemStatusClient />);

    expect(await screen.findByText('203.0.113.5')).toBeInTheDocument();
    expect(
      screen.getByText('Too many failed sign-in attempts from this address'),
    ).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText(/21 attempts counted, 4 turned away since/)).toBeInTheDocument();
    // Both "restricted since" and "expires" are shown relative to the server's clock.
    expect(screen.getByText('5 minutes ago')).toBeInTheDocument();
    expect(screen.getByText('in 25 minutes')).toBeInTheDocument();
  });

  it('shows what is known about the address itself', async () => {
    localStorage.setItem('afct.systemStatusTab', 'rate-limits');
    renderWithClient(<SystemStatusClient />);

    // Reverse-DNS name and classification, which is what identifies a campus address.
    expect(await screen.findByText('lab-12.cs.example.edu')).toBeInTheDocument();
    expect(screen.getByText('Public internet address (IPv4)')).toBeInTheDocument();
    // And what AFCT's own log already knows about it.
    expect(screen.getByText('12 accounts (shared address)')).toBeInTheDocument();
    expect(screen.getByText('482 events in 30 days')).toBeInTheDocument();
  });

  it('clears one rate limit only after the administrator confirms', async () => {
    localStorage.setItem('afct.systemStatusTab', 'rate-limits');
    renderWithClient(<SystemStatusClient />);

    fireEvent.click(
      await screen.findByRole('button', { name: /Clear the restriction on 203\.0\.113\.5/ }),
    );

    // Nothing has been sent yet: the confirmation is still open.
    expect(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([u]) =>
        String(u).includes('/status/rate-limits/clear'),
      ),
    ).toBe(false);

    fireEvent.click(await screen.findByRole('button', { name: 'Clear rate limit' }));

    await waitFor(() => {
      const posted = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([u]) =>
        String(u).includes('/status/rate-limits/clear'),
      );
      expect(posted).toBeDefined();
      const init = posted?.[1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({
        scope: 'login:ip',
        ip: '203.0.113.5',
      });
    });
  });

  it('cancelling the confirmation sends nothing', async () => {
    localStorage.setItem('afct.systemStatusTab', 'rate-limits');
    renderWithClient(<SystemStatusClient />);

    fireEvent.click(
      await screen.findByRole('button', { name: /Clear the restriction on 203\.0\.113\.5/ }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([u]) =>
        String(u).includes('/status/rate-limits/clear'),
      ),
    ).toBe(false);
  });
});
