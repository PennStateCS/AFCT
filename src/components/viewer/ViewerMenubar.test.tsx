/** @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ViewerMenubar } from './ViewerMenubar';
import { ViewerActionsProvider, useRegisterViewerActions } from './viewer-actions';

const actions = {
  downloadSVG: vi.fn(),
  downloadPNG: vi.fn(),
  copyPNG: vi.fn(),
  toggleGrid: vi.fn(),
  setAsDrawn: vi.fn(),
  setAutoArranged: vi.fn(),
};

/** Stands in for a rendered machine that publishes its actions and its view state. */
function FakeViewer({
  grid = false,
  layout = 'as-drawn',
}: {
  grid?: boolean;
  layout?: 'as-drawn' | 'auto';
}) {
  useRegisterViewerActions(actions, { grid, layout });
  return null;
}

const openFile = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('menuitem', { name: 'File' }));

describe('the standalone viewer menu bar', () => {
  it('offers the original file as a download, marked as one', async () => {
    // ?download=1 is what makes the file route record a download rather than a view. The two
    // are deliberately different access events, so the link must carry it.
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <ViewerMenubar downloadHref="/api/files/submissions/abc.jff?download=1" />
      </ViewerActionsProvider>,
    );
    await openFile(user);
    const link = await screen.findByRole('menuitem', { name: /download original file/i });
    expect(link).toHaveAttribute('href', '/api/files/submissions/abc.jff?download=1');
  });

  it('runs the export the viewer registered', async () => {
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <FakeViewer />
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await openFile(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Export' }));
    // fireEvent, not userEvent, for this one click. Radix decides whether an item is
    // clickable partly from pointer-events, which jsdom cannot compute without layout, so a
    // realistic click lands on a menu item that reports itself unclickable and onSelect
    // never runs. The item is not disabled (the case below proves the disabled path
    // separately), and a real browser has no such trouble.
    fireEvent.click(await screen.findByRole('menuitem', { name: 'SVG' }));
    expect(actions.downloadSVG).toHaveBeenCalledTimes(1);
  });

  it('disables the exports when nothing has registered, rather than hiding them', async () => {
    // A grammar or a regular expression has nothing to export. A missing item reads as a
    // bug; a disabled one reads as "not for this kind of file".
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await openFile(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Export' }));
    expect(await screen.findByRole('menuitem', { name: 'PNG' })).toHaveAttribute(
      'data-disabled',
    );
  });
});

describe('the View menu', () => {
  const openView = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('menuitem', { name: 'View' }));

  it('shows the grid ticked when the viewer has it on', async () => {
    // The menu reports the current state rather than only offering the action, so it cannot
    // disagree with the Grid button in the viewer's own toolbar.
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <FakeViewer grid />
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await openView(user);
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Grid' })).toBeChecked();
  });

  it('shows it unticked when the viewer has it off', async () => {
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <FakeViewer grid={false} />
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await openView(user);
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Grid' })).not.toBeChecked();
  });

  it('asks the viewer to toggle the grid when selected', async () => {
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <FakeViewer />
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await openView(user);
    // fireEvent for the same jsdom reason as the export case above.
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Grid' }));
    expect(actions.toggleGrid).toHaveBeenCalledTimes(1);
  });

  it('disables the toggle when no graph is rendered', async () => {
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await openView(user);
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Grid' })).toHaveAttribute(
      'data-disabled',
    );
  });
});

describe('the Edit menu', () => {
  it('copies the drawing to the clipboard', async () => {
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <FakeViewer />
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /copy png/i }));
    expect(actions.copyPNG).toHaveBeenCalledTimes(1);
  });
});

describe('View, Layout', () => {
  const openLayout = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('menuitem', { name: 'View' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Layout' }));
  };

  it('marks exactly one of the two, never both', async () => {
    // The machine is drawn one way or the other. A pair of checkboxes could show neither or
    // both, which is why these are radio items.
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <FakeViewer layout="auto" />
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await openLayout(user);
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.filter((i) => i.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(screen.getByRole('menuitemradio', { name: 'Auto-arranged' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'As drawn' })).not.toBeChecked();
  });

  it('follows the viewer when it is drawn as the author placed it', async () => {
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <FakeViewer layout="as-drawn" />
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await openLayout(user);
    expect(screen.getByRole('menuitemradio', { name: 'As drawn' })).toBeChecked();
  });

  it('asks for auto-arranging when that one is chosen', async () => {
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <FakeViewer layout="as-drawn" />
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await openLayout(user);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Auto-arranged' }));
    expect(actions.setAutoArranged).toHaveBeenCalledTimes(1);
    expect(actions.setAsDrawn).not.toHaveBeenCalled();
  });
});
