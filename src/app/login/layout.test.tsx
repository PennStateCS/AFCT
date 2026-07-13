import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());
const redirectError = vi.hoisted(() => new Error('NEXT_REDIRECT'));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import LoginLayout from './layout';

beforeEach(() => {
  vi.clearAllMocks();
  redirectMock.mockImplementation(() => {
    throw redirectError;
  });
});

describe('LoginLayout', () => {
  it('redirects authenticated standard users to dashboard', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', mustChangePassword: false } });

    await expect(LoginLayout({ children: <div>Child</div> })).rejects.toThrow(redirectError);

    expect(redirectMock).toHaveBeenCalledWith('/dashboard');
  });

  it('redirects authenticated temp-password users to change-password', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', mustChangePassword: true } });

    await expect(LoginLayout({ children: <div>Child</div> })).rejects.toThrow(redirectError);

    expect(redirectMock).toHaveBeenCalledWith('/change-password');
  });

  it('renders children for unauthenticated users', async () => {
    authMock.mockResolvedValue(null);
    redirectMock.mockReset();

    const result = await LoginLayout({ children: <div data-testid="child">Child</div> });
    const element = result as React.ReactElement<any>;

    expect(redirectMock).not.toHaveBeenCalled();
    expect(element.props.children.props.children.props['data-testid']).toBe('child');
  });

  it('renders the login form for an inactive (idle-expired/disabled) session instead of looping', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', inactive: true } });
    redirectMock.mockReset();

    const result = await LoginLayout({ children: <div data-testid="child">Child</div> });
    const element = result as React.ReactElement<any>;

    expect(redirectMock).not.toHaveBeenCalled();
    expect(element.props.children.props.children.props['data-testid']).toBe('child');
  });
});
