/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { UnsavedChangesProvider } from './UnsavedChangesProvider';
import { useDiscardGuard } from './useDiscardGuard';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/**
 * The discard guard against the REAL dialog primitives.
 *
 * These tests cannot live in the per-dialog test files: those mock `@/components/ui/dialog`
 * into plain divs, which strips Escape, roles, and the close path entirely. The three product
 * dialogs wire this hook with five identical lines each; the behaviour worth proving lives
 * here, against a host dialog whose Escape and confirm are the real thing.
 */
function HostDialog() {
  const [open, setOpen] = React.useState(true);
  const [text, setText] = React.useState('');
  const { requestClose, discardConfirm } = useDiscardGuard({
    dirty: open && text.length > 0,
    onDiscard: () => {
      setOpen(false);
      setText('');
    },
  });
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            requestClose();
            return;
          }
          setOpen(next);
        }}
      >
        <DialogContent>
          <DialogTitle>Edit the thing</DialogTitle>
          <DialogDescription>A stand-in for the problem and wizard dialogs.</DialogDescription>
          <input
            aria-label="Field"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </DialogContent>
      </Dialog>
      {discardConfirm}
      <output aria-label="Dialog state">{open ? 'open' : 'closed'}</output>
    </>
  );
}

const mount = () =>
  render(
    <UnsavedChangesProvider>
      <HostDialog />
    </UnsavedChangesProvider>,
  );

const host = () => screen.getByRole('dialog', { name: 'Edit the thing' });
const confirm = () => screen.queryByRole('dialog', { name: 'Discard unsaved changes?' });
const state = () => screen.getByLabelText('Dialog state').textContent;
const makeDirty = () =>
  fireEvent.change(screen.getByLabelText('Field'), { target: { value: 'half-built problem' } });

describe('useDiscardGuard', () => {
  it('closes a pristine dialog on Escape without asking', async () => {
    mount();
    fireEvent.keyDown(host(), { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(state()).toBe('closed'));
    expect(confirm()).toBeNull();
  });

  it('asks before discarding a dirty dialog', async () => {
    mount();
    makeDirty();
    fireEvent.keyDown(host(), { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(confirm()).not.toBeNull());
    expect(state()).toBe('open');
  });

  it('Keep editing preserves the form', async () => {
    mount();
    makeDirty();
    fireEvent.keyDown(host(), { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(confirm()).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

    await waitFor(() => expect(confirm()).toBeNull());
    expect(state()).toBe('open');
    expect(screen.getByLabelText('Field')).toHaveValue('half-built problem');
  });

  it('Discard changes closes and resets', async () => {
    mount();
    makeDirty();
    fireEvent.keyDown(host(), { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(confirm()).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

    await waitFor(() => expect(state()).toBe('closed'));
    expect(confirm()).toBeNull();
  });

  it('Escape on the confirm means keep editing, never discard', async () => {
    mount();
    makeDirty();
    fireEvent.keyDown(host(), { key: 'Escape', code: 'Escape' });
    const confirmDialog = await screen.findByRole('dialog', {
      name: 'Discard unsaved changes?',
    });

    fireEvent.keyDown(confirmDialog, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(confirm()).toBeNull());
    expect(state()).toBe('open');
    expect(screen.getByLabelText('Field')).toHaveValue('half-built problem');
  });

  it('registers with the page-level guard, so refresh is covered while the dialog is dirty', () => {
    const added = vi.spyOn(window, 'addEventListener');
    mount();
    expect(added.mock.calls.map(([type]) => type)).not.toContain('beforeunload');

    makeDirty();
    expect(added.mock.calls.map(([type]) => type)).toContain('beforeunload');
  });
});
