/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PublicAddressCard } from './PublicAddressCard';

const toastError = vi.fn();
vi.mock('@/lib/toast', () => ({
  showToast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const URL_VALUE = 'https://afct-computing-theory.example-university.edu';

/**
 * Replace the clipboard for one test.
 *
 * Must run AFTER userEvent.setup(), which installs a clipboard stub of its own and would
 * otherwise swallow the call: the first version of these tests asserted on a spy the
 * component never reached, and passed the success case for the wrong reason.
 */
function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

describe('PublicAddressCard', () => {
  beforeEach(() => {
    toastError.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the address as text, not as a form control', () => {
    render(<PublicAddressCard configuredUrl={URL_VALUE} loading={false} />);

    expect(screen.getByText(URL_VALUE)).toBeVisible();
    // The whole point of the change: it used to be a read-only InputGroup, which put a
    // labelled, bordered, focusable box around a value nobody can edit.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(document.querySelector('input')).toBeNull();
  });

  it('is a labelled region titled Public address', () => {
    render(<PublicAddressCard configuredUrl={URL_VALUE} loading={false} />);

    const card = screen.getByRole('complementary', { name: 'Public address' });
    expect(card).toContainElement(screen.getByText(URL_VALUE));
    expect(screen.getByRole('heading', { level: 2, name: 'Public address' })).toBeVisible();
  });

  it('keeps the operational facts about changing it', () => {
    render(<PublicAddressCard configuredUrl={URL_VALUE} loading={false} />);

    expect(screen.getByRole('heading', { level: 3, name: 'How to change it' })).toBeVisible();
    expect(screen.getByText('NEXTAUTH_URL')).toBeVisible();
    expect(screen.getByText('sh install.sh --reconfigure')).toBeVisible();
    expect(screen.getByText(/APP_URL=https:\/\/new\.address/)).toBeVisible();
    expect(screen.getByText(/preserves your data and secrets/)).toBeVisible();
  });

  it('copies the configured address and says so', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<PublicAddressCard configuredUrl={URL_VALUE} loading={false} />);

    await user.click(screen.getByRole('button', { name: 'Copy public address' }));

    expect(writeText).toHaveBeenCalledWith(URL_VALUE);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Public address copied to the clipboard.',
      ),
    );
  });

  /*
   * A refused clipboard (an insecure origin, a denied permission) must not leave the button
   * claiming it worked. That is the failure worth pinning: the address is still on screen
   * and selectable, so the honest outcome is a message, not a silent lie.
   */
  it('does not claim success when the clipboard refuses', async () => {
    const user = userEvent.setup();
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));

    render(<PublicAddressCard configuredUrl={URL_VALUE} loading={false} />);

    await user.click(screen.getByRole('button', { name: 'Copy public address' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent('');
    // Still readable, so the manual route the message points at actually exists.
    expect(screen.getByText(URL_VALUE)).toBeVisible();
  });

  it('offers to copy again after the copied state lapses', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    vi.useFakeTimers();

    render(<PublicAddressCard configuredUrl={URL_VALUE} loading={false} />);
    // fireEvent rather than userEvent: userEvent's own timer plumbing fights fake timers,
    // and what is under test here is the reset, not the click.
    fireEvent.click(screen.getByRole('button', { name: 'Copy public address' }));

    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent('Public address copied');

    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('has nothing to copy while the address is still loading', () => {
    render(<PublicAddressCard configuredUrl={undefined} loading />);

    expect(screen.getByRole('button', { name: 'Copy public address' })).toBeDisabled();
    expect(screen.getByText('Loading…')).toBeVisible();
  });

  it('says so when no address is configured', () => {
    render(<PublicAddressCard configuredUrl={undefined} loading={false} />);

    expect(screen.getByText('Not set')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy public address' })).toBeDisabled();
  });
});
