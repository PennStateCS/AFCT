/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const putMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/fetch-client', () => ({
  apiClient: { put: putMock },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/toast', () => ({ showToast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { AssignmentBasicsForm } from './AssignmentBasicsForm';
import { UnsavedChangesProvider } from '@/components/unsaved-changes/UnsavedChangesProvider';
import { warmRichDescriptionEditor, WARM_TIMEOUT_MS } from '@/test/rich-editor';
import {
  BLOCK_MATH_NODE,
  INLINE_MATH_NODE,
  RICH_DESCRIPTION_VERSION,
  type RichDescriptionEnvelope,
} from '@/lib/rich-description';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/**
 * Dirty state on the assignment Details tab, driven the way a professor drives it.
 *
 * The bug these cover: inserting an equation left Save disabled. The editor was emitting the
 * change correctly; the form threw it away. `initialDescriptionJson` arrives as
 * `asRichDescription(...)` computed inline in the page, which is a Zod parse and therefore a new
 * object on every render, and the form's re-seed effect depended on that object, so it re-ran on
 * every parent render and cleared the flag. Typing hid it, because the next keystroke set the
 * flag again; an equation emits once, so the next render threw the edit away.
 */
const doc = (...content: unknown[]): RichDescriptionEnvelope =>
  ({
    version: RICH_DESCRIPTION_VERSION,
    document: { type: 'doc', content },
  }) as RichDescriptionEnvelope;

const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (value: string) => ({ type: 'text', text: value });
const inlineMath = (latex: string) => ({ type: INLINE_MATH_NODE, attrs: { latex } });

const PLAIN = 'Build a DFA for the language';
const stored = doc(para(text(PLAIN)));
const storedWithMath = doc(
  para(text('Show that '), inlineMath('a^n b^n'), text(' is not regular')),
);

const BASE = {
  courseId: 'c1',
  assignmentId: 'a1',
  initialTitle: 'Pumping Lemma',
  initialDescription: PLAIN,
};

const save = () => screen.getByRole('button', { name: /^save$/i });
const editor = () => screen.getByRole('textbox', { name: 'Description' });

async function mount(json: RichDescriptionEnvelope | null = stored) {
  const view = render(<AssignmentBasicsForm {...BASE} initialDescriptionJson={json} />);
  await screen.findByRole('textbox', { name: 'Description' });
  return view;
}

/** Open the equation dialog from the toolbar and fill in a source. */
async function openEquation(latex?: string, placement?: 'Display' | 'Inline') {
  fireEvent.click(screen.getByRole('button', { name: /^(insert|edit) equation$/i }));
  const field = await screen.findByLabelText('LaTeX');
  if (placement) fireEvent.click(screen.getByRole('radio', { name: placement }));
  if (latex !== undefined) fireEvent.change(field, { target: { value: latex } });
  return field;
}

const commit = () =>
  fireEvent.click(screen.getByRole('button', { name: /^(save|update) equation$/i }));

describe('assignment dirty state: equations', () => {
  beforeAll(warmRichDescriptionEditor, WARM_TIMEOUT_MS);
  beforeEach(() => {
    vi.clearAllMocks();
    putMock.mockResolvedValue({ id: 'a1' });
  });

  it('starts pristine', async () => {
    await mount();
    expect(save()).toBeDisabled();
  });

  it('enables Save when an inline equation is inserted', async () => {
    await mount();
    await openEquation('a^n b^n');
    commit();

    await waitFor(() => expect(save()).not.toBeDisabled());
    expect(document.querySelector('[data-type="inline-math"]')).not.toBeNull();
  });

  it('enables Save when a display equation is inserted', async () => {
    await mount();
    await openEquation('\\sum_{i=1}^{n} i', 'Display');
    commit();

    await waitFor(() => expect(save()).not.toBeDisabled());
  });

  /**
   * Editing, converting and removing an existing equation are driven through the dialog in
   * equation-conversion.test and equation-abandon.test: selecting a node view means clicking
   * rendered MathML, and jsdom has no layout, so the click never reaches ProseMirror. They share
   * the single onChange path the insert cases above prove end to end.
   */
  it('enables Save when an equation is removed', async () => {
    await mount(storedWithMath);
    fireEvent.click(document.querySelector('[data-type="inline-math"]')!);
    await screen.findByLabelText('LaTeX');
    fireEvent.click(screen.getByRole('button', { name: /remove equation/i }));

    await waitFor(() => expect(save()).not.toBeDisabled());
  });

  it('leaves the form pristine when the dialog is cancelled after typing', async () => {
    await mount();
    await openEquation('a^n b^n');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(save()).toBeDisabled();
  });

  it('leaves the form pristine when the dialog is dismissed with Escape', async () => {
    await mount();
    const field = await openEquation('a^n b^n');
    fireEvent.keyDown(field, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(screen.queryByLabelText('LaTeX')).toBeNull());
    expect(save()).toBeDisabled();
  });

  it('leaves the form pristine when the dialog is opened and closed untouched', async () => {
    await mount();
    await openEquation();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(save()).toBeDisabled();
  });

  it('survives a parent re-render that rebuilds the stored document', async () => {
    const { rerender } = await mount(structuredClone(stored));
    await openEquation('a^n b^n');
    commit();
    await waitFor(() => expect(save()).not.toBeDisabled());

    // The page computes asRichDescription(...) inline, so every render hands the form an equal
    // but brand-new object. That must not count as "the assignment changed".
    rerender(<AssignmentBasicsForm {...BASE} initialDescriptionJson={structuredClone(stored)} />);

    expect(save()).not.toBeDisabled();
  });

  it('sends the edited document when the form is saved', async () => {
    await mount();
    await openEquation('a^n b^n');
    commit();
    await waitFor(() => expect(save()).not.toBeDisabled());

    // Committing an equation must not save the assignment: the dialog is portaled, but React
    // synthetic events travel the React tree, so its submit used to reach this form.
    expect(putMock).not.toHaveBeenCalled();

    fireEvent.click(save());

    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    const body = putMock.mock.calls[0][1];
    expect(JSON.stringify(body.descriptionJson)).toContain(INLINE_MATH_NODE);
    expect(body.title).toBe('Pumping Lemma');
  });
});

describe('assignment dirty state: returning to the original', () => {
  beforeAll(warmRichDescriptionEditor, WARM_TIMEOUT_MS);
  beforeEach(() => vi.clearAllMocks());

  it('goes back to pristine when the equation is undone', async () => {
    await mount();
    await openEquation('a^n b^n');
    commit();
    await waitFor(() => expect(save()).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    // The document is the stored one again, so there is nothing to save. A boolean "an edit
    // happened" flag could not express this.
    await waitFor(() => expect(save()).toBeDisabled());
  });

  it('goes back to pristine when the title is retyped to its original value', async () => {
    await mount();
    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Something else' } });
    expect(save()).not.toBeDisabled();

    fireEvent.change(title, { target: { value: BASE.initialTitle } });
    expect(save()).toBeDisabled();
  });

  it('does not mark a legacy plain-text assignment dirty just by mounting', async () => {
    await mount(null);
    expect(editor().textContent).toContain(PLAIN);
    expect(save()).toBeDisabled();
  });
});

describe('assignment dirty state: other editor commands', () => {
  beforeAll(warmRichDescriptionEditor, WARM_TIMEOUT_MS);
  beforeEach(() => vi.clearAllMocks());

  it('enables Save for a structural formatting command', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Bullet list' }));

    await waitFor(() => expect(save()).not.toBeDisabled());
  });

  it('enables Save for a block style change, then pristine again after undo', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Quote' }));
    await waitFor(() => expect(save()).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(save()).toBeDisabled());
  });
});

describe('rich description comparison', () => {
  it('treats a display equation as different from the same source inline', () => {
    const inline = doc(para(inlineMath('x')));
    const block = doc({ type: BLOCK_MATH_NODE, attrs: { latex: 'x' } });
    expect(JSON.stringify(inline)).not.toBe(JSON.stringify(block));
  });
});

describe('assignment dirty state: the unsaved-changes guard', () => {
  beforeAll(warmRichDescriptionEditor, WARM_TIMEOUT_MS);
  beforeEach(() => vi.clearAllMocks());

  it('challenges an in-app link once the form is dirty, and not before', async () => {
    render(
      <UnsavedChangesProvider>
        <AssignmentBasicsForm {...BASE} initialDescriptionJson={stored} />
        <a href="/dashboard/elsewhere">Back to courses</a>
      </UnsavedChangesProvider>,
    );
    await screen.findByRole('textbox', { name: 'Description' });

    // Pristine: the link is not intercepted.
    fireEvent.click(screen.getByRole('link', { name: 'Back to courses' }));
    expect(screen.queryByRole('dialog', { name: 'Discard unsaved changes?' })).toBeNull();

    // Dirty via a real edit path: change the title.
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('link', { name: 'Back to courses' }));
    expect(
      await screen.findByRole('dialog', { name: 'Discard unsaved changes?' }),
    ).toBeInTheDocument();

    // Staying preserves the edit.
    fireEvent.click(screen.getByRole('button', { name: 'Stay on page' }));
    expect(screen.getByLabelText('Title')).toHaveValue('Renamed');
  });

  it('releases the guard when the title returns to its stored value', async () => {
    render(
      <UnsavedChangesProvider>
        <AssignmentBasicsForm {...BASE} initialDescriptionJson={stored} />
        <a href="/dashboard/elsewhere">Back to courses</a>
      </UnsavedChangesProvider>,
    );
    await screen.findByRole('textbox', { name: 'Description' });

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renamed' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: BASE.initialTitle } });
    fireEvent.click(screen.getByRole('link', { name: 'Back to courses' }));

    expect(screen.queryByRole('dialog', { name: 'Discard unsaved changes?' })).toBeNull();
  });
});

/**
 * A second edit, after a save has already landed.
 *
 * Saving refetches, so the form is handed genuinely new stored content, which is a real change and
 * must not be confused with the same-content re-render above. The editor keeps its document across
 * that refetch (it is uncontrolled and is only remounted when the assignment changes), so it never
 * reports a fresh baseline, and the form has to rebaseline itself when the save succeeds. Getting
 * this wrong strands the form: Save stays disabled no matter what is typed, and because the form
 * also looks pristine, leaving the page does not warn.
 */
describe('assignment dirty state: after a save', () => {
  beforeAll(warmRichDescriptionEditor, WARM_TIMEOUT_MS);
  beforeEach(() => {
    vi.clearAllMocks();
    putMock.mockResolvedValue({ id: 'a1' });
  });

  it('goes pristine after saving, then dirty again on the next edit', async () => {
    const { rerender } = await mount(structuredClone(stored));

    await openEquation('a^n b^n');
    commit();
    await waitFor(() => expect(save()).not.toBeDisabled());
    fireEvent.click(save());
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));

    // The refetch lands: the stored document is now the one that was just saved.
    const saved = putMock.mock.calls[0][1].descriptionJson as RichDescriptionEnvelope;
    rerender(
      <AssignmentBasicsForm
        {...BASE}
        initialDescription="Show that a^n b^n is not regular"
        initialDescriptionJson={structuredClone(saved)}
      />,
    );

    await waitFor(() => expect(save()).toBeDisabled());

    // A second edit still has to count.
    await openEquation('\sum_{i=1}^{n} i', 'Display');
    commit();
    await waitFor(() => expect(save()).not.toBeDisabled());
  });

  it('keeps the title editable and dirty-tracked after a save', async () => {
    const { rerender } = await mount(structuredClone(stored));

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renamed' } });
    fireEvent.click(save());
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));

    rerender(
      <AssignmentBasicsForm
        {...BASE}
        initialTitle="Renamed"
        initialDescriptionJson={structuredClone(stored)}
      />,
    );
    await waitFor(() => expect(save()).toBeDisabled());

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renamed again' } });
    expect(save()).not.toBeDisabled();
  });
});
