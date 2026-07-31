/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { RichDescriptionEditor } from './RichDescriptionEditor';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/**
 * Disabled mode, which read-only coverage does NOT stand in for.
 *
 * The two states are deliberately different and are announced differently: a read-only editor
 * stays focusable so its content can be navigated, selected and copied, while a disabled one
 * leaves the tab sequence entirely, the way every other disabled control in AFCT does. Both
 * appear in real use: read-only on a viewer, disabled on a form for an archived course.
 *
 * Every command control is listed by name on purpose. A loop over "whatever buttons happen to
 * be rendered" passes just as happily when a control silently disappears, and the toolbar has
 * width tiers that hide controls, so an absent control is not automatically a bug: the check is
 * that anything PRESENT is disabled, plus an explicit assertion that the tier-independent
 * controls are there at all.
 */
const COMMANDS = [
  'Undo',
  'Redo',
  'Bold',
  'Italic',
  'Underline',
  'Inline code',
  'Add link',
  'Insert equation',
  'Bullet list',
  'Numbered list',
  'Quote',
  'Code block',
  'Horizontal rule',
  'Align left',
  'Align center',
  'Align right',
];

async function mount(props: Partial<React.ComponentProps<typeof RichDescriptionEditor>> = {}) {
  render(
    <RichDescriptionEditor showToolbar ariaLabel="Description" value="Stored text" {...props} />,
  );
  return screen.findByRole('textbox');
}

describe('a disabled editor', () => {
  it('announces disabled rather than read-only, and leaves the tab sequence', async () => {
    const box = await mount({ disabled: true });

    expect(box).toHaveAttribute('aria-disabled', 'true');
    // Not both: a control that claims to be read-only AND disabled tells AT two stories.
    expect(box).not.toHaveAttribute('aria-readonly');
    expect(box.getAttribute('tabindex')).toBe('-1');
    expect(box.getAttribute('contenteditable')).toBe('false');
  });

  it('disables every command control that is on screen', async () => {
    await mount({ disabled: true });

    for (const name of COMMANDS) {
      const control =
        screen.queryByRole('button', { name }) ?? screen.queryByRole('radio', { name });
      if (control) expect(control, `${name} should be disabled`).toBeDisabled();
    }
    expect(screen.getByRole('combobox', { name: 'Text style' })).toBeDisabled();
  });

  it('still offers the controls that are about reading, not editing', async () => {
    await mount({ disabled: true });

    // Expanding to read a long description, and looking up a shortcut, need no edit rights.
    expect(screen.getByRole('button', { name: 'Expand editor' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Keyboard shortcuts' })).toBeEnabled();
  });

  it('does not emit a change when the disabled surface is clicked', async () => {
    const onChange = vi.fn();
    render(
      <RichDescriptionEditor
        showToolbar
        disabled
        ariaLabel="Description"
        value="Stored text"
        onChange={onChange}
      />,
    );
    await screen.findByRole('textbox');

    // The click net that places a caret in an editable editor must stay out of the way here.
    const surface = document.querySelector('[data-slot="rich-description-editor"] .relative')!;
    fireEvent.mouseDown(surface);

    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it('offers no resize grip, because there is nothing to size for editing', async () => {
    await mount({ disabled: true });
    expect(document.querySelector('.resize-y')).toBeNull();
  });

  it('keeps showing the stored content', async () => {
    const box = await mount({ disabled: true });
    // Disabled hides the controls, never the content: staff still need to read it.
    expect(box.textContent).toContain('Stored text');
  });
});

describe('disabled and read-only are not the same state', () => {
  it('differ on focusability and on what they announce', async () => {
    const { unmount } = render(
      <RichDescriptionEditor readOnly ariaLabel="Description" value="Stored text" />,
    );
    const readOnlyBox = await screen.findByRole('textbox');
    expect(readOnlyBox).toHaveAttribute('aria-readonly', 'true');
    expect(readOnlyBox).not.toHaveAttribute('aria-disabled');
    expect(readOnlyBox.getAttribute('tabindex')).not.toBe('-1');
    unmount();

    const disabledBox = await mount({ disabled: true });
    expect(disabledBox).toHaveAttribute('aria-disabled', 'true');
    expect(disabledBox).not.toHaveAttribute('aria-readonly');
    expect(disabledBox.getAttribute('tabindex')).toBe('-1');
  });
});
