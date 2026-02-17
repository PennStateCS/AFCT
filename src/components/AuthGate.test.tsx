/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import AuthGate from './AuthGate';

const replaceMock = vi.fn();
const useSessionMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => useSessionMock(),
}));

beforeEach(() => {
  replaceMock.mockReset();
  useSessionMock.mockReset();
});

describe('AuthGate', () => {
  it('renders children when the user is authenticated', () => {
    useSessionMock.mockReturnValue({ status: 'authenticated' });

    render(
      <AuthGate>
        <p>Protected</p>
      </AuthGate>,
    );

    expect(screen.getByText('Protected')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('renders nothing while the session status is loading', () => {
    useSessionMock.mockReturnValue({ status: 'loading' });

    render(
      <AuthGate>
        <p>Protected</p>
      </AuthGate>,
    );

    expect(screen.queryByText('Protected')).toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('redirects to /login when unauthenticated', async () => {
    useSessionMock.mockReturnValue({ status: 'unauthenticated' });

    render(
      <AuthGate>
        <p>Protected</p>
      </AuthGate>,
    );

    expect(screen.queryByText('Protected')).toBeNull();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
  });
});
