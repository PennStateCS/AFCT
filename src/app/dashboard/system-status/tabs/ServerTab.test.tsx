/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const useStatusQueryMock = vi.hoisted(() => vi.fn());

// The tab fetches its own data through the shared status hook. Mocking that keeps this about
// what it renders, which is the whole point of the card the host report now sits in.
vi.mock('../status-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../status-ui')>()),
  useStatusQuery: useStatusQueryMock,
}));

import ServerTab from './ServerTab';

const payload = (host: Record<string, unknown>) => ({
  system: { arch: 'x64', cpuCount: 4, uptime: 600, hostname: 'afct-prod', ipAddresses: [] },
  software: { nodeVersion: 'v22.23.1' },
  host,
});

const renderWith = (host: Record<string, unknown>) => {
  useStatusQueryMock.mockReturnValue({ data: payload(host), isLoading: false });
  return render(<ServerTab active autoRefresh={false} windowHours={1} />);
};

const healthy = {
  available: true,
  checkedAt: new Date().toISOString(),
  osName: 'Ubuntu 24.04.1 LTS',
  rebootRequired: false,
  updatesAvailable: 0,
  securityUpdatesAvailable: 0,
  timeSynchronised: true,
};

describe('the server tab', () => {
  it('puts the machine’s own state in its own card, named so it is not read as AFCT’s', () => {
    renderWith(healthy);

    expect(screen.getByRole('heading', { name: 'This server' })).toBeInTheDocument();
    expect(screen.getByText('All clear')).toBeInTheDocument();
    expect(screen.getByText(/computer AFCT is installed on/i)).toBeInTheDocument();
    expect(screen.getByText(/Running Ubuntu 24.04.1 LTS/)).toBeInTheDocument();
  });

  it('shows every notice, not only the one it leads with', () => {
    renderWith({ ...healthy, securityUpdatesAvailable: 3, timeSynchronised: false });

    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('3 security updates are waiting')).toBeInTheDocument();
    expect(screen.getByText('The server clock is not keeping time')).toBeInTheDocument();
  });

  /** A server AFCT cannot see must never come out looking like a healthy one. */
  it('says it cannot tell, rather than going quiet, when there is no report', () => {
    renderWith({ available: false, reason: 'no-report' });

    expect(screen.getByText('Not available')).toBeInTheDocument();
    expect(screen.getByText(/update service is not running/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Running /)).not.toBeInTheDocument();
  });

  it('still shows the readings the tab is for', () => {
    renderWith(healthy);

    expect(screen.getByRole('heading', { name: 'Performance' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Software' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'CPU process usage' })).toBeInTheDocument();
  });
});
