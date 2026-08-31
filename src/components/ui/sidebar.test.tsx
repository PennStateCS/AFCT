/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SidebarProvider, useSidebar } from './sidebar';

/**
 * The window-level Ctrl/Cmd+B shortcut, and the text fields it has to keep its hands off.
 *
 * The rich description editor binds Ctrl+B to bold and is a contenteditable region, so before
 * #790 an author bolding a word also toggled the sidebar. jsdom cannot show that, but it can
 * show the guard: the same chord from a contenteditable target must leave the sidebar alone.
 */

/** Reports the sidebar's state, so the assertions read observable output rather than internals. */
function StateProbe() {
  const { open } = useSidebar();
  return <span data-testid="state">{open ? 'open' : 'closed'}</span>;
}

const renderSidebar = () =>
  render(
    <SidebarProvider defaultOpen>
      <StateProbe />
      <div contentEditable data-testid="editor" />
      <button data-testid="plain">plain</button>
    </SidebarProvider>,
  );

/** Dispatched from the element so it bubbles to the window listener, as a real keypress does. */
const pressCtrlB = (from: Element) => {
  act(() => {
    from.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }),
    );
  });
};

const state = () => screen.getByTestId('state').textContent;

describe('the sidebar keyboard shortcut', () => {
  it('toggles the sidebar from an ordinary element', () => {
    renderSidebar();
    expect(state()).toBe('open');

    pressCtrlB(screen.getByTestId('plain'));

    expect(state()).toBe('closed');
  });

  it('leaves the sidebar alone when the chord comes from a rich text editor', () => {
    // The reported bug (#790): bold and the sidebar both fired. Bold is the documented binding,
    // so the sidebar has to yield rather than act in parallel.
    renderSidebar();
    const editor = screen.getByTestId('editor');
    // jsdom does not derive isContentEditable from the attribute, so state it outright.
    Object.defineProperty(editor, 'isContentEditable', { value: true });

    pressCtrlB(editor);

    expect(state()).toBe('open');
  });

  it('leaves the sidebar alone while typing in an input', () => {
    const { container } = render(
      <SidebarProvider defaultOpen>
        <StateProbe />
        <input data-testid="field" />
      </SidebarProvider>,
    );
    expect(container).toBeTruthy();

    pressCtrlB(screen.getByTestId('field'));

    expect(state()).toBe('open');
  });
});
