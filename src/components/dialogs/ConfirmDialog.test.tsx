/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { ConfirmDialog } from './ConfirmDialog';

// The dialog primitive is mocked to plain wrappers; Button and Input render for real, so
// these tests exercise the confirm/cancel wiring, variant styling, the busy/double-submit
// guard, and the type-to-confirm gate. Focus management and Escape are delegated to Radix
// and are not asserted here (jsdom does no layout).
vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled;

describe('ConfirmDialog', () => {
  it('calls callbacks for confirm and cancel actions', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open
        onConfirm={onConfirm}
        onCancel={onCancel}
        title="Delete item"
        description="Danger"
        confirmText="Delete"
        cancelText="No"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('styles the confirm button by variant', () => {
    const { rerender } = render(
      <ConfirmDialog
        open
        onConfirm={() => {}}
        onCancel={() => {}}
        confirmText="Delete"
        variant="destructive"
      />,
    );
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('bg-destructive');

    rerender(
      <ConfirmDialog
        open
        onConfirm={() => {}}
        onCancel={() => {}}
        confirmText="Publish"
        variant="default"
      />,
    );
    expect(screen.getByRole('button', { name: 'Publish' }).className).not.toContain(
      'bg-destructive',
    );
  });

  it('disables both buttons and ignores confirm while the busy prop is set', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open
        busy
        onConfirm={onConfirm}
        onCancel={() => {}}
        confirmText="Delete"
      />,
    );

    const confirm = screen.getByRole('button', { name: 'Delete' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(isDisabled(confirm)).toBe(true);
    expect(isDisabled(cancel)).toBe(true);

    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('prevents repeat submissions while a promise-returning confirm is in flight', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const onConfirm = vi.fn(() => pending.promise);

    render(
      <ConfirmDialog open onConfirm={onConfirm} onCancel={() => {}} confirmText="Delete" />,
    );

    const confirm = screen.getByRole('button', { name: 'Delete' });
    await user.click(confirm);
    // Second click lands while the first action is still resolving.
    await user.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(isDisabled(confirm)).toBe(true);

    pending.resolve();
    await waitFor(() => expect(isDisabled(confirm)).toBe(false));
  });

  it('keeps confirm disabled until the required text is typed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open
        onConfirm={onConfirm}
        onCancel={() => {}}
        confirmText="Restore"
        requireTypedConfirmation="1.2.3"
      />,
    );

    const confirm = screen.getByRole('button', { name: 'Restore' });
    expect(isDisabled(confirm)).toBe(true);

    await user.type(screen.getByLabelText('Type 1.2.3 to confirm'), '1.2.3');
    expect(isDisabled(confirm)).toBe(false);

    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalled();
  });
});
