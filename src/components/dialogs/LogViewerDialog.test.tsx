/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { LogViewerDialog } from './LogViewerDialog';

const { showToastSuccess, showToastError } = vi.hoisted(() => ({
  showToastSuccess: vi.fn(),
  showToastError: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showToast: { success: showToastSuccess, error: showToastError },
}));

// Deliberately NOT mocking @/components/ui/dialog: the point of this file is the real
// header/body/footer structure, which a stubbed dialog would render away.

// The two are deliberately different: the dialog shows the readable rendering and copies the
// raw entry, so a test that used one string for both could not tell the buttons apart.
const DATA = 'Signed in\nWho: Ada Lovelace';
const JSON_DATA = JSON.stringify({ action: 'LOGIN', userId: 'u1' }, null, 2);

const renderDialog = (props: Partial<React.ComponentProps<typeof LogViewerDialog>> = {}) =>
  render(
    <LogViewerDialog
      data={DATA}
      json={JSON_DATA}
      open
      onOpenChange={vi.fn()}
      title="System Log"
      {...props}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LogViewerDialog', () => {
  it('renders the entry and falls back to a default title', () => {
    renderDialog({ title: null });

    expect(screen.getByRole('heading', { name: 'System Log' })).toBeInTheDocument();
    // The readable rendering, not the raw entry: that is what the body shows.
    expect(screen.getByRole('region', { name: 'Log contents' })).toHaveTextContent('Signed in');
  });

  // jsdom does no layout, so this cannot prove the footer stays put. What it can prove is the
  // structure that makes it stay put: the body is its own scroll container, so it is the body
  // that overflows rather than the whole dialog.
  it('scrolls the entry itself rather than the whole dialog', () => {
    renderDialog();

    const body = screen.getByRole('region', { name: 'Log contents' });
    expect(body.className).toContain('overflow-y-auto');
    // Without min-h-0 a flex child cannot shrink below its content, and the footer gets
    // pushed out of the dialog instead of the body scrolling.
    expect(body.className).toContain('min-h-0');
  });

  // A container a mouse can scroll has to be reachable by keyboard, and needs a name so it is
  // not announced as an anonymous box.
  it('exposes the scroll container to the keyboard', () => {
    renderDialog();

    expect(screen.getByRole('region', { name: 'Log contents' })).toHaveAttribute('tabindex', '0');
  });

  it('copies the readable text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Copy text' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(DATA));
    expect(showToastSuccess).toHaveBeenCalledWith('Text copied to clipboard');
    expect(showToastError).not.toHaveBeenCalled();
  });

  /**
   * The reason both buttons exist: the rendered text renames things to read well, and a bug
   * report or a disclosure record needs the field names as they actually are.
   */
  it('copies the raw entry, not the rendered text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Copy JSON' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON_DATA));
    expect(writeText).not.toHaveBeenCalledWith(DATA);
    expect(showToastSuccess).toHaveBeenCalledWith('JSON copied to clipboard');
  });

  it('reports a failed copy instead of silently doing nothing', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Copy text' }));

    await waitFor(() => expect(showToastError).toHaveBeenCalledWith('Could not copy the text'));
    expect(showToastSuccess).not.toHaveBeenCalled();
  });
});
