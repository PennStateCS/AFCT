/** @vitest-environment jsdom */

import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CacheResetOnIdentityChange } from './QueryProvider';

const useSessionMock = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({ useSession: useSessionMock }));

const authed = (id: string, isAdmin = false) => ({
  status: 'authenticated' as const,
  data: { user: { id, isAdmin } },
});

function renderGuard() {
  const client = new QueryClient();
  const clear = vi.spyOn(client, 'clear');
  const view = render(
    <QueryClientProvider client={client}>
      <CacheResetOnIdentityChange />
    </QueryClientProvider>,
  );
  const rerender = () =>
    view.rerender(
      <QueryClientProvider client={client}>
        <CacheResetOnIdentityChange />
      </QueryClientProvider>,
    );
  return { clear, rerender };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CacheResetOnIdentityChange', () => {
  it('records the baseline identity without clearing on first render', () => {
    useSessionMock.mockReturnValue(authed('u1'));
    const { clear } = renderGuard();
    expect(clear).not.toHaveBeenCalled();
  });

  it('clears the cache when the user id changes', () => {
    useSessionMock.mockReturnValue(authed('u1'));
    const { clear, rerender } = renderGuard();
    expect(clear).not.toHaveBeenCalled();

    useSessionMock.mockReturnValue(authed('u2'));
    rerender();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('clears the cache when the admin flag flips for the same user', () => {
    useSessionMock.mockReturnValue(authed('u1', false));
    const { clear, rerender } = renderGuard();

    useSessionMock.mockReturnValue(authed('u1', true));
    rerender();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('clears the cache on sign-out (authenticated -> unauthenticated)', () => {
    useSessionMock.mockReturnValue(authed('u1'));
    const { clear, rerender } = renderGuard();

    useSessionMock.mockReturnValue({ status: 'unauthenticated', data: null });
    rerender();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('does not clear while the session is still loading', () => {
    useSessionMock.mockReturnValue({ status: 'loading', data: null });
    const { clear, rerender } = renderGuard();

    useSessionMock.mockReturnValue(authed('u1'));
    rerender();
    // First settled read just records the baseline: no clear.
    expect(clear).not.toHaveBeenCalled();
  });

  it('does not clear on an unrelated re-render with the same identity', () => {
    useSessionMock.mockReturnValue(authed('u1', true));
    const { clear, rerender } = renderGuard();
    rerender();
    rerender();
    expect(clear).not.toHaveBeenCalled();
  });
});
