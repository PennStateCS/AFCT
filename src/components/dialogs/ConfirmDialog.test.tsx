/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { ConfirmDialog } from './ConfirmDialog';

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

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
});
