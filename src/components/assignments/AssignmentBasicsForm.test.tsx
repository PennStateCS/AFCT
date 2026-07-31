/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const putMock = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/fetch-client', () => ({
  apiClient: { put: putMock },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/toast', () => ({
  showToast: { success: toastSuccess, error: toastError },
}));
vi.mock('@/components/ui/select', () => import('@/test/mocks/ui').then((mod) => mod.selectMock));
vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));

import { AssignmentBasicsForm } from './AssignmentBasicsForm';
import { RICH_DESCRIPTION_VERSION, type RichDescriptionEnvelope } from '@/lib/rich-description';
import { warmRichDescriptionEditor, WARM_TIMEOUT_MS } from '@/test/rich-editor';

const richDescription: RichDescriptionEnvelope = {
  version: RICH_DESCRIPTION_VERSION,
  document: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rich body' }] }],
  },
};

function renderForm(over: Partial<React.ComponentProps<typeof AssignmentBasicsForm>> = {}) {
  render(
    <AssignmentBasicsForm
      courseId="c1"
      assignmentId="a1"
      initialTitle="Pumping Lemma"
      initialDescription="Legacy plain text"
      {...over}
    />,
  );
}

/** The description editor, once Tiptap has mounted on the client. */
function editor() {
  return screen.getByRole('textbox', { name: 'Description' });
}

async function waitForEditor() {
  await waitFor(() => expect(document.querySelector('.tiptap')).not.toBeNull());
  return editor();
}

/** Type into the editor the way ProseMirror can be driven in jsdom. */
function typeInEditor(text: string) {
  const dom = editor();
  fireEvent.input(dom, {
    // ProseMirror reads the DOM after an input event, so mutate then dispatch.
    target: Object.assign(dom, { textContent: text }),
  });
}

describe('AssignmentBasicsForm', () => {
  beforeAll(warmRichDescriptionEditor, WARM_TIMEOUT_MS);

  beforeEach(() => {
    vi.clearAllMocks();
    putMock.mockResolvedValue({ id: 'a1' });
  });

  it('opens a legacy assignment with its plain text in the editor', async () => {
    renderForm();
    const dom = await waitForEditor();
    expect(dom.textContent).toContain('Legacy plain text');
    expect(putMock).not.toHaveBeenCalled();
  });

  it('opens a rich assignment with its stored document', async () => {
    renderForm({ initialDescriptionJson: richDescription, initialDescription: 'Rich body' });
    const dom = await waitForEditor();
    expect(dom.textContent).toContain('Rich body');
  });

  it('does not convert a legacy assignment when only the title is saved', async () => {
    renderForm();
    await waitForEditor();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Pumping Lemma II' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    const body = putMock.mock.calls[0][1];
    expect(body.title).toBe('Pumping Lemma II');
    // A plain-text write of the unchanged description: the record stays PLAIN_TEXT.
    expect(body.description).toBe('Legacy plain text');
    expect(body.descriptionJson).toBeUndefined();
  });

  it('re-sends the stored document when a rich assignment has only its title saved', async () => {
    renderForm({ initialDescriptionJson: richDescription, initialDescription: 'Rich body' });
    await waitForEditor();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    expect(putMock.mock.calls[0][1].descriptionJson).toEqual(richDescription);
    expect(putMock.mock.calls[0][1].description).toBeUndefined();
  });

  it('converts a legacy assignment once the description is edited and saved', async () => {
    renderForm();
    await waitForEditor();

    typeInEditor('Now with formatting');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    const body = putMock.mock.calls[0][1];
    expect(body.descriptionJson?.version).toBe(RICH_DESCRIPTION_VERSION);
    expect(body.description).toBeUndefined();
  });

  it('saves nothing until something changes', async () => {
    renderForm();
    await waitForEditor();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it('keeps the editor content when validation fails', async () => {
    renderForm();
    await waitForEditor();

    typeInEditor('Draft that must survive');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 3 characters/i);
    expect(putMock).not.toHaveBeenCalled();
    expect(editor().textContent).toContain('Draft that must survive');
  });

  it('surfaces a failed save without losing the edit', async () => {
    putMock.mockRejectedValue(new Error('nope'));
    renderForm();
    await waitForEditor();

    typeInEditor('Still here');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(editor().textContent).toContain('Still here');
  });
});
