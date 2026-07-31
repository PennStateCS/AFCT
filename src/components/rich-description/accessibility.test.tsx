/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { RichDescriptionEditor } from './RichDescriptionEditor';
import { EquationDialog } from './EquationDialog';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/** The contenteditable, which is the element that owns the textbox role and its state. */
function textbox(): HTMLElement {
  return screen.getByRole('textbox');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('editor state is exposed to assistive technology', () => {
  it('marks a read-only editor read-only and keeps it focusable', async () => {
    render(<RichDescriptionEditor readOnly ariaLabel="Description" />);
    const box = await screen.findByRole('textbox');

    // Read-only, not disabled: the two are announced differently and mean different things.
    expect(box).toHaveAttribute('aria-readonly', 'true');
    expect(box).not.toHaveAttribute('aria-disabled');
    // Still reachable, so the content can be navigated, selected, and copied.
    expect(box.getAttribute('tabindex')).not.toBe('-1');
  });

  it('marks a disabled editor disabled and removes it from the tab sequence', async () => {
    render(<RichDescriptionEditor disabled ariaLabel="Description" />);
    const box = await screen.findByRole('textbox');

    expect(box).toHaveAttribute('aria-disabled', 'true');
    // Disabled controls are not tab stops, matching AFCT's other disabled form controls.
    expect(box).toHaveAttribute('tabindex', '-1');
    // aria-readonly would be contradictory here; disabled already implies not editable.
    expect(box).not.toHaveAttribute('aria-readonly');
  });

  it('leaves an ordinary editor with neither state', async () => {
    render(<RichDescriptionEditor ariaLabel="Description" />);
    const box = await screen.findByRole('textbox');
    expect(box).not.toHaveAttribute('aria-readonly');
    expect(box).not.toHaveAttribute('aria-disabled');
  });

  it('exposes exactly one textbox, on the contenteditable rather than a wrapper', async () => {
    render(<RichDescriptionEditor showToolbar ariaLabel="Description" />);
    await screen.findByRole('textbox');
    // A second textbox role on the wrapper would make the editor ambiguous to voice control and
    // make a screen reader announce two edit fields for one control.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(textbox().getAttribute('contenteditable')).not.toBeNull();
  });
});

describe('toolbar accessible names', () => {
  it('offers to insert an equation when nothing is selected', async () => {
    render(<RichDescriptionEditor showToolbar ariaLabel="Description" />);
    expect(await screen.findByRole('button', { name: 'Insert equation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit equation' })).toBeNull();
  });

  it('gives every icon-only control a unique accessible name', async () => {
    render(<RichDescriptionEditor showToolbar ariaLabel="Description" />);
    await screen.findByRole('textbox');

    const names = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '')
      .filter(Boolean);

    expect(names.every((n) => n.length > 0)).toBe(true);

    /**
     * The overflow menu is rendered once per width tier, and all of them say "More formatting".
     * That is not ambiguous on screen: a container query displays exactly one, so a user only ever
     * meets a single trigger. jsdom applies no CSS, so every tier is in the tree here. Collapse
     * them to one before checking, and keep asserting uniqueness for everything else, because a
     * genuine duplicate ("click Bold" hitting two controls) is what this test is for.
     */
    const distinct = names.filter((n, i) => n !== 'More formatting' || names.indexOf(n) === i);
    expect(new Set(distinct).size).toBe(distinct.length);
  });
});

/**
 * The equation dialog is rendered directly here rather than driven through the editor: the
 * announcement behaviour is a property of the dialog, and testing it in isolation keeps the fake
 * timers away from Tiptap's own async setup.
 */
function renderDialog(props: Partial<React.ComponentProps<typeof EquationDialog>> = {}) {
  return render(
    <EquationDialog editor={null} open onOpenChange={() => {}} target={null} {...props} />,
  );
}

describe('equation preview', () => {
  it('is findable by role and accessible name', async () => {
    renderDialog();
    // Named, so it is not an anonymous box of symbols in the accessibility tree.
    expect(await screen.findByRole('region', { name: 'Preview' })).toBeInTheDocument();
  });

  it('is not a live region, so intermediate expressions are not announced', async () => {
    renderDialog();
    const preview = await screen.findByRole('region', { name: 'Preview' });
    // The preview changes on every keystroke. Speaking each version would be unusable.
    expect(preview).not.toHaveAttribute('aria-live');
  });
});

describe('latex errors are announced politely and not repeatedly', () => {
  it('describes the field without firing an assertive alert', async () => {
    const user = userEvent.setup();
    renderDialog();

    const field = await screen.findByLabelText('LaTeX');
    await user.type(field, '\\frac{{');

    // No role="alert": an assertive region would interrupt on nearly every keystroke, because
    // half-typed LaTeX is invalid LaTeX.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    const describedBy = field.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBeTruthy();
  });

  it('keeps Save unavailable while the equation is invalid', async () => {
    const user = userEvent.setup();
    renderDialog();
    const field = await screen.findByLabelText('LaTeX');
    await user.type(field, '\\frac{{');
    expect(screen.getByRole('button', { name: 'Save equation' })).toBeDisabled();
  });

  it('waits for typing to settle before announcing, and does not repeat itself', () => {
    // fireEvent rather than userEvent: each keystroke re-renders KaTeX, and driving that
    // per-character under fake timers is slow enough to time the test out. What matters here is
    // the debounce, not the typing mechanics.
    vi.useFakeTimers();
    renderDialog();

    const field = screen.getByLabelText('LaTeX');
    const liveRegion = document.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(liveRegion).toBeTruthy();

    fireEvent.change(field, { target: { value: '\\frac{' } });
    // Mid-expression: the message is visible, but nothing has been spoken yet.
    expect(liveRegion.textContent).toBe('');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const firstAnnouncement = liveRegion.textContent;
    expect(firstAnnouncement).toBeTruthy();

    // More typing that leaves the same error must not repeat the same sentence.
    fireEvent.change(field, { target: { value: '\\frac{x' } });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(liveRegion.textContent).toBe(firstAnnouncement);
  });

  it('announces immediately when an invalid equation is submitted', () => {
    // A submission is a deliberate act, so it does not wait on the typing debounce.
    // A stub editor is enough: submitting an EMPTY equation fails validation and returns before
    // any command runs, so nothing here needs a real Tiptap instance.
    vi.useFakeTimers();
    const editorStub = {
      chain: () => ({ focus: () => ({ run: () => undefined }) }),
    } as unknown as Parameters<typeof EquationDialog>[0]['editor'];
    renderDialog({ editor: editorStub });

    const liveRegion = document.querySelector('[aria-live="polite"]') as HTMLElement;
    fireEvent.submit(screen.getByLabelText('LaTeX').closest('form')!);
    expect(liveRegion.textContent).toMatch(/enter a latex expression/i);
  });
});

describe('equation dialog actions', () => {
  it('names its actions clearly when inserting', async () => {
    renderDialog();
    expect(await screen.findByRole('button', { name: 'Save equation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    // Nothing to remove yet.
    expect(screen.queryByRole('button', { name: 'Remove equation' })).toBeNull();
  });

  it('offers update and remove when editing an existing equation', async () => {
    renderDialog({ target: { mode: 'inline', latex: 'n^2', pos: 3 } });
    expect(await screen.findByRole('button', { name: 'Update equation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove equation' })).toBeInTheDocument();
  });

  it('seeds the field and placement from the equation being edited', async () => {
    renderDialog({ target: { mode: 'block', latex: 'x+1', pos: 3 } });
    expect(await screen.findByLabelText('LaTeX')).toHaveValue('x+1');
    // Placement uses native radio semantics, so the current mode is exposed as checked.
    const placement = screen.getByRole('radiogroup');
    expect(within(placement).getByRole('radio', { name: 'Display' })).toBeChecked();
  });

  it('lets the mode be switched with the keyboard', async () => {
    const user = userEvent.setup();
    renderDialog({ target: { mode: 'inline', latex: 'x', pos: 3 } });
    const placement = await screen.findByRole('radiogroup');
    const display = within(placement).getByRole('radio', { name: 'Display' });

    await user.click(display);
    expect(display).toBeChecked();
  });
});
