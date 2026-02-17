/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

import { JoinCourseModule } from './JoinCourseModule';

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
  },
}));

vi.mock('@/components/ui/input-otp', () => {
  const InputOTPSlot = ({ index }: { index: number }) => <input aria-label={`slot-${index}`} />;
  return {
    InputOTP: ({ children, value = '', onChange }: any) => (
      <div>
        <input
          aria-label="otp-input"
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
        />
        {children}
      </div>
    ),
    InputOTPGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    InputOTPSlot,
    InputOTPSeparator: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

const originalFetch = global.fetch;
const fetchMock = vi.fn();

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('JoinCourseModule', () => {
  it('prevents submission until a full code is entered', async () => {
    const user = userEvent.setup();
    render(<JoinCourseModule />);

    const input = screen.getByLabelText('otp-input');
    await user.type(input, 'ABC');

    const joinButton = screen.getByRole('button', { name: 'Join' });
    expect(joinButton).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('submits the code and shows success feedback on success', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ course: { name: 'Software Engineering' } }),
    } as Response);

    render(<JoinCourseModule />);

    const input = screen.getByLabelText('otp-input');
    await user.type(input, 'ABCDEF');

    const joinButton = screen.getByRole('button', { name: 'Join' });
    expect(joinButton).toBeEnabled();

    await user.click(joinButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/courses/join',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'ABCDEF' }),
        }),
      ),
    );

    expect(toastSuccess).toHaveBeenCalledWith('You have joined Software Engineering');
    expect(input).toHaveValue('');
  });

  it('shows an error toast when the request fails', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Invalid code' }),
    } as Response);

    render(<JoinCourseModule />);

    const input = screen.getByLabelText('otp-input');
    await user.type(input, 'ABCDEF');
    await user.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Invalid code'));
    expect(input).toHaveValue('');
  });
});
