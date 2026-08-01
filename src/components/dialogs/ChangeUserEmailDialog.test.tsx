/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangeUserEmailDialog } from './ChangeUserEmailDialog';

const getMock = vi.hoisted(() => vi.fn());
const patchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/fetch-client', () => ({
  apiClient: { get: getMock, patch: patchMock },
  ApiError: class ApiError extends Error {},
}));
import { toastMock } from '@/test/mocks/toast';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

const renderDialog = (over: Partial<React.ComponentProps<typeof ChangeUserEmailDialog>> = {}) => {
  const onChanged = vi.fn();
  const setOpen = vi.fn();
  render(
    <ChangeUserEmailDialog
      open
      setOpen={setOpen}
      userId="u1"
      currentEmail="old@example.com"
      userName="Ada Lovelace"
      onChanged={onChanged}
      {...over}
    />,
  );
  return { onChanged, setOpen };
};

describe('ChangeUserEmailDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Availability check: only "taken@" is reported as existing.
    getMock.mockImplementation((url: string) => Promise.resolve({ exists: url.includes('taken') }));
    patchMock.mockResolvedValue({ id: 'u1' });
  });

  it('prefills the current email and disables Save until it changes', () => {
    renderDialog();
    expect((screen.getByLabelText('New email') as HTMLInputElement).value).toBe('old@example.com');
    expect(screen.getByRole('button', { name: 'Change Email' })).toBeDisabled();
  });

  it('saves a new, available email (lowercased) and reports success', async () => {
    const { onChanged, setOpen } = renderDialog();
    fireEvent.change(screen.getByLabelText('New email'), { target: { value: 'New@Example.com' } });

    // Wait for the debounced availability check to mark it available.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Change Email' })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change Email' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/users/u1', { email: 'new@example.com' }),
    );
    expect(toastMock.updated).toHaveBeenCalledWith('Email address');
    expect(onChanged).toHaveBeenCalled();
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('blocks a taken email with an inline error and no request', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('New email'), {
      target: { value: 'taken@example.com' },
    });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/already in use/i));
    expect(screen.getByRole('button', { name: 'Change Email' })).toBeDisabled();
    expect(patchMock).not.toHaveBeenCalled();
  });
});
