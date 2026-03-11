import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());
const redirectError = vi.hoisted(() => new Error('NEXT_REDIRECT'));
const forcedPasswordChangeFormMock = vi.hoisted(() =>
  vi.fn(() => <div data-testid="forced-password-form" />),
);

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/components/auth/ForcedPasswordChangeForm', () => ({
  ForcedPasswordChangeForm: forcedPasswordChangeFormMock,
}));

import ChangePasswordPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  redirectMock.mockImplementation(() => {
    throw redirectError;
  });
});

describe('ChangePasswordPage', () => {
  it('redirects unauthenticated users to login', async () => {
    authMock.mockResolvedValue(null);

    await expect(ChangePasswordPage()).rejects.toThrow(redirectError);

    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('redirects standard users to dashboard', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', mustChangePassword: false } });

    await expect(ChangePasswordPage()).rejects.toThrow(redirectError);

    expect(redirectMock).toHaveBeenCalledWith('/dashboard');
  });

  it('renders forced password form for temp-password users', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', mustChangePassword: true } });
    redirectMock.mockReset();

    const result = await ChangePasswordPage();
    const element = result as React.ReactElement;

    expect(redirectMock).not.toHaveBeenCalled();
    expect(element.type).toBe(forcedPasswordChangeFormMock);
  });
});
