/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const useStatusQueryMock = vi.hoisted(() => vi.fn());

// The component fetches its own data through the shared status hook. Mocking that keeps this
// about what the tab renders, which is the part that failed a person in an incident.
vi.mock('../status-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../status-ui')>()),
  useStatusQuery: useStatusQueryMock,
}));
vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

import DatabaseTab from './DatabaseTab';

/**
 * The connection count is the one number on this page somebody reads in an incident.
 *
 * Running out of connections is not a slow decline: the database refuses the next client
 * outright, the app cannot even run its startup migration, and the failures that follow look
 * like anything except a resource limit. A bare count cannot tell you whether you are near
 * that wall, which is why it is shown against the maximum.
 */
const pg = (over: Record<string, unknown> = {}) => ({
  ok: true,
  details: { provider: 'postgres' },
  stats: { pg: { num_backends: 7, max_connections: 200, ...over } },
});

const renderWith = (data: Record<string, unknown>) => {
  useStatusQueryMock.mockReturnValue({ data, isLoading: false });
  return render(<DatabaseTab active autoRefresh={false} />);
};

describe('the database tab', () => {
  it('shows connections against the ceiling, not on their own', () => {
    renderWith(pg());

    expect(screen.getByText('7 / 200')).toBeInTheDocument();
  });

  it('still shows the count when the server did not report a maximum', () => {
    renderWith(pg({ max_connections: null }));

    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('calls out connections idle in a transaction, which hold locks as well as a slot', () => {
    renderWith(pg({ connections_idle_in_xact: 3 }));

    expect(screen.getByText('Idle in transaction')).toBeInTheDocument();
  });

  it('stays quiet about idle transactions when there are none', () => {
    renderWith(pg({ connections_idle_in_xact: 0 }));

    expect(screen.queryByText('Idle in transaction')).not.toBeInTheDocument();
  });
});
