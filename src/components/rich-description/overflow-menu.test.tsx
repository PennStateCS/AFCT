/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Quote, Minus } from 'lucide-react';

import { ToolbarOverflowMenu, type ToolbarCommand } from './RichDescriptionToolbar';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/**
 * The menu is tested on its own rather than through the editor because which commands overflow is
 * decided by a container query, and jsdom does no layout: mounting the toolbar in a test always
 * gives the wide arrangement. What matters here is that a command renders the same way as a menu
 * item as it does as a button, which is a property of this component alone.
 */
function commands(overrides: Partial<ToolbarCommand>[] = []): ToolbarCommand[] {
  const base: ToolbarCommand[] = [
    {
      id: 'blockquote',
      label: 'Quote',
      tooltip: 'Quote',
      Icon: Quote,
      pressed: false,
      disabled: false,
      run: vi.fn(),
    },
    {
      id: 'horizontalRule',
      label: 'Horizontal rule',
      tooltip: 'Horizontal rule',
      Icon: Minus,
      disabled: false,
      run: vi.fn(),
    },
  ];
  return base.map((command, index) => ({ ...command, ...(overrides[index] ?? {}) }));
}

/**
 * Radix marks everything outside an open menu `aria-hidden`, so the trigger cannot be queried by
 * role once the menu is up. Hand it back from here instead.
 */
async function openMenu(list: ToolbarCommand[]) {
  const user = userEvent.setup();
  render(<ToolbarOverflowMenu commands={list} />);
  const trigger = screen.getByRole('button', { name: 'More formatting' });
  await user.click(trigger);
  await screen.findByRole('menu');
  return { user, trigger };
}

describe('ToolbarOverflowMenu', () => {
  it('shows a toggle command as a checkbox item and a plain command as an item', async () => {
    await openMenu(commands());

    expect(screen.getByRole('menuitemcheckbox', { name: 'Quote' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Horizontal rule' })).toBeTruthy();
  });

  it('ticks the item that is already applied', async () => {
    await openMenu(commands([{ pressed: true }]));

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Quote' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('disables an item whose command is disabled', async () => {
    await openMenu(commands([{ disabled: true }, { disabled: true }]));

    for (const item of screen
      .getAllByRole('menuitem')
      .concat(screen.getAllByRole('menuitemcheckbox'))) {
      expect(item.getAttribute('data-disabled')).not.toBeNull();
    }
  });

  it('turns a toggle command on when it is not applied', async () => {
    const list = commands();
    const { user } = await openMenu(list);
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Quote' }));

    expect(list[0].run).toHaveBeenCalledWith(true);
  });

  it('turns a toggle command off when it is already applied', async () => {
    const list = commands([{ pressed: true }]);
    const { user } = await openMenu(list);
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Quote' }));

    expect(list[0].run).toHaveBeenCalledWith(false);
  });

  it('runs a plain command', async () => {
    const list = commands();
    const { user } = await openMenu(list);
    await user.click(screen.getByRole('menuitem', { name: 'Horizontal rule' }));

    expect(list[1].run).toHaveBeenCalledWith(true);
  });

  it('leaves focus alone after a command so the editor keeps the caret', async () => {
    const list = commands();
    const { user, trigger } = await openMenu(list);
    await user.click(screen.getByRole('menuitem', { name: 'Horizontal rule' }));

    expect(document.activeElement).not.toBe(trigger);
  });

  it('returns focus to the trigger when dismissed without running anything', async () => {
    const { user, trigger } = await openMenu(commands());
    await user.keyboard('{Escape}');

    expect(document.activeElement).toBe(trigger);
  });
});
