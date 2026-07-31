/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { RichDescriptionEditor } from './RichDescriptionEditor';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/**
 * The editing surface itself: clicking the box, resizing it, and the shortcuts reference.
 *
 * jsdom applies no layout, so these prove the WIRING (the handler runs, the caret lands, the
 * classes are present) and deliberately cannot prove geometry. `posAtCoords` returns null here,
 * which conveniently exercises the fallback path a real browser uses when a click lands outside
 * any text line.
 */
describe('clicking the editor box', () => {
  it('focuses the document when the click lands outside the contenteditable', async () => {
    const { container } = render(
      <RichDescriptionEditor showToolbar ariaLabel="Description" value="Some text" />,
    );
    const textbox = await screen.findByRole('textbox');
    expect(document.activeElement).not.toBe(textbox);

    // The click net is the wrapper AROUND the contenteditable: the dead zone this fixes.
    const wrapper = container.querySelector('[data-slot="rich-description-editor"] .relative')!;
    fireEvent.mouseDown(wrapper);

    await waitFor(() => expect(document.activeElement).toBe(textbox));
  });

  it('does not steal focus while disabled', async () => {
    const { container } = render(
      <RichDescriptionEditor showToolbar disabled ariaLabel="Description" value="Some text" />,
    );
    await screen.findByRole('textbox');

    const wrapper = container.querySelector('[data-slot="rich-description-editor"] .relative')!;
    fireEvent.mouseDown(wrapper);

    expect(document.activeElement).toBe(document.body);
  });

  it('does not mark the document changed just by placing the caret', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <RichDescriptionEditor
        showToolbar
        ariaLabel="Description"
        value="Some text"
        onChange={onChange}
      />,
    );
    await screen.findByRole('textbox');

    const wrapper = container.querySelector('[data-slot="rich-description-editor"] .relative')!;
    fireEvent.mouseDown(wrapper);

    // Focus and selection are not edits. A change event here would defeat the dirty tracking
    // that the assignment form builds on this callback.
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('resizing', () => {
  it('offers the resize handle on the editable surface', async () => {
    const { container } = render(<RichDescriptionEditor showToolbar ariaLabel="Description" />);
    await screen.findByRole('textbox');

    expect(container.querySelector('.resize-y')).not.toBeNull();
  });

  it('does not offer it while disabled', async () => {
    const { container } = render(
      <RichDescriptionEditor showToolbar disabled ariaLabel="Description" />,
    );
    await screen.findByRole('textbox');

    expect(container.querySelector('.resize-y')).toBeNull();
  });
});

describe('the keyboard shortcuts dialog', () => {
  it('opens from the toolbar, lists the shortcuts, and closes on Escape', async () => {
    render(<RichDescriptionEditor showToolbar ariaLabel="Description" />);
    await screen.findByRole('textbox');

    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));

    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(dialog.textContent).toContain('Bold');
    expect(dialog.textContent).toContain('Ctrl/Command+B');
    expect(dialog.textContent).toContain('Redo');
    expect(dialog.textContent).toContain('Ctrl/Command+Shift+Z');

    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull(),
    );
  });

  it('says what the buttons say', async () => {
    // The dialog and the tooltips read the same map, so the Bold tooltip and the Bold row can
    // never disagree. This pins the map's values so a careless edit to one key shows up here.
    const { EDITOR_SHORTCUTS } = await import('./KeyboardShortcutsDialog');
    expect(EDITOR_SHORTCUTS.bold).toBe('Ctrl/Command+B');
    expect(EDITOR_SHORTCUTS.link).toBe('Ctrl/Command+K');
  });
});
