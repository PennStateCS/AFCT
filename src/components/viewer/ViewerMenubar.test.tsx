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
  downloadCurrent: vi.fn(),
  copySVG: vi.fn(),
  copyDescription: vi.fn(),
  toggleGrid: vi.fn(),
  toggleNotes: vi.fn(),
  fitToWindow: vi.fn(),
  showTextRepresentation: vi.fn(),
  setAsDrawn: vi.fn(),
  setAutoArranged: vi.fn(),
};

/** Stands in for a rendered machine that publishes its actions and its view state. */
function FakeViewer({
  grid = false,
  notes = true,
  layout = 'as-drawn',
}: {
  grid?: boolean;
  notes?: boolean;
  layout?: 'as-drawn' | 'auto';
}) {
  useRegisterViewerActions(actions, { grid, notes, layout });
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
    await user.click(await screen.findByRole('menuitem', { name: 'Download' }));
    const link = await screen.findByRole('menuitem', { name: /original file/i });
    expect(link).toHaveAttribute('href', '/api/files/submissions/abc.jff?download=1');
  });

  it('offers the current view as a separate download', async () => {
    // Two distinct things: what the student submitted, and what is on screen after the layout
    // engine has had a go at it. Collapsing them into one item would hide that difference.
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <FakeViewer />
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await openFile(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Download' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /current view/i }));
    expect(actions.downloadCurrent).toHaveBeenCalledTimes(1);
  });

  it('still offers the original when nothing is drawn, since that needs no graph', async () => {
    // A grammar has no rendered machine, so there is no current view to save. The submitted
    // file is still right there and must not be disabled with it.
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await openFile(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Download' }));
    expect(await screen.findByRole('menuitem', { name: /original file/i })).not.toHaveAttribute(
      'data-disabled',
    );
    expect(await screen.findByRole('menuitem', { name: /current view/i })).toHaveAttribute(
      'data-disabled',
    );
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
  const openEdit = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('menuitem', { name: 'Edit' }));

  const mountWithViewer = () =>
    render(
      <ViewerActionsProvider>
        <FakeViewer />
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );

  it.each([
    [/copy as png/i, 'copyPNG'],
    [/copy as svg/i, 'copySVG'],
    [/copy as text/i, 'copyDescription'],
  ] as const)('runs %s', async (name, action) => {
    const user = userEvent.setup();
    mountWithViewer();
    await openEdit(user);
    // fireEvent for the same jsdom reason as the export case above.
    fireEvent.click(await screen.findByRole('menuitem', { name }));
    expect(actions[action]).toHaveBeenCalledTimes(1);
  });

  it('offers all three ways of copying, since each pastes somewhere the others cannot', async () => {
    // PNG into a document, SVG into a drawing program, text into a reply. Losing one of
    // these silently would look like a tidy-up rather than a regression.
    const user = userEvent.setup();
    mountWithViewer();
    await openEdit(user);
    const items = await screen.findAllByRole('menuitem');
    const labels = items.map((i) => i.textContent);
    expect(labels.filter((l) => l?.startsWith('Copy as'))).toHaveLength(3);
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

describe('View, Fit to window', () => {
  it('asks the viewer to fit the machine on screen', async () => {
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <FakeViewer />
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await user.click(screen.getByRole('menuitem', { name: 'View' }));
    // fireEvent for the same jsdom reason as the export case above.
    fireEvent.click(await screen.findByRole('menuitem', { name: /fit to window/i }));
    expect(actions.fitToWindow).toHaveBeenCalledTimes(1);
  });

  it('is unavailable when nothing is drawn', async () => {
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await user.click(screen.getByRole('menuitem', { name: 'View' }));
    expect(await screen.findByRole('menuitem', { name: /fit to window/i })).toHaveAttribute(
      'data-disabled',
    );
  });
});

describe('View, Text representation', () => {
  it('asks the viewer to show the machine written out', async () => {
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <FakeViewer />
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await user.click(screen.getByRole('menuitem', { name: 'View' }));
    // fireEvent for the same jsdom reason as the export case above.
    fireEvent.click(await screen.findByRole('menuitem', { name: /text representation/i }));
    expect(actions.showTextRepresentation).toHaveBeenCalledTimes(1);
  });
});

describe('View, JFLAP Notes', () => {
  const openView = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('menuitem', { name: 'View' }));

  it('is ticked by default, because a note is part of the answer', async () => {
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <FakeViewer />
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await openView(user);
    expect(await screen.findByRole('menuitemcheckbox', { name: 'JFLAP Notes' })).toBeChecked();
  });

  it('follows the viewer when they are hidden', async () => {
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <FakeViewer notes={false} />
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await openView(user);
    expect(
      await screen.findByRole('menuitemcheckbox', { name: 'JFLAP Notes' }),
    ).not.toBeChecked();
  });

  it('asks the viewer to toggle them', async () => {
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <FakeViewer />
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await openView(user);
    // fireEvent for the same jsdom reason as the export case above.
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'JFLAP Notes' }));
    expect(actions.toggleNotes).toHaveBeenCalledTimes(1);
  });
});

describe('the Help menu', () => {
  it('links to the published documentation for this viewer', async () => {
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await user.click(screen.getByRole('menuitem', { name: 'Help' }));
    const link = await screen.findByRole('menuitem', { name: /documentation/i });
    // The trailing slash is the canonical form; without it GitHub Pages answers a redirect.
    expect(link).toHaveAttribute('href', 'https://pennstatecs.github.io/AFCT/admin/submissions/');
  });

  it('opens it away from the window, without handing over an opener', async () => {
    // It leaves the application, so the new tab must not keep a handle back to this one.
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await user.click(screen.getByRole('menuitem', { name: 'Help' }));
    const link = await screen.findByRole('menuitem', { name: /documentation/i });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('is available even when no machine is drawn', async () => {
    // Help is about the window, not its contents. A grammar disables everything else in the
    // menus, and being unable to reach the documentation from there would be perverse.
    const user = userEvent.setup();
    render(
      <ViewerActionsProvider>
        <ViewerMenubar downloadHref="/x?download=1" />
      </ViewerActionsProvider>,
    );
    await user.click(screen.getByRole('menuitem', { name: 'Help' }));
    expect(await screen.findByRole('menuitem', { name: /documentation/i })).not.toHaveAttribute(
      'data-disabled',
    );
  });
});
