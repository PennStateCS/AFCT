/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuplicateProblemDialog } from './DuplicateProblemDialog';
import { warmRichDescriptionEditor, WARM_TIMEOUT_MS } from '@/test/rich-editor';

const postMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/fetch-client', () => ({
  apiClient: { post: postMock },
  ApiError: class ApiError extends Error {},
}));
import { toastMock } from '@/test/mocks/toast';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

const baseProblem = {
  id: 'p1',
  title: 'Pipelining Lab',
  description: 'Original description',
};

const renderDialog = (over: Partial<React.ComponentProps<typeof DuplicateProblemDialog>> = {}) => {
  const onDuplicated = vi.fn();
  const setOpen = vi.fn();
  render(
    <DuplicateProblemDialog
      open
      setOpen={setOpen}
      courseId="c1"
      courseIsArchived={false}
      problem={baseProblem}
      onDuplicated={onDuplicated}
      {...over}
    />,
  );
  return { onDuplicated, setOpen };
};

describe('DuplicateProblemDialog', () => {
  beforeAll(warmRichDescriptionEditor, WARM_TIMEOUT_MS);

  beforeEach(() => {
    vi.clearAllMocks();
    postMock.mockResolvedValue({ id: 'p2' });
  });

  /** The description editor, once Tiptap has mounted on the client. */
  const editor = () => screen.getByRole('textbox', { name: 'Description' });

  it('prefills the title and description from the source', async () => {
    renderDialog();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Pipelining Lab');
    // The description is now the rich editor, seeded with the source's text.
    await waitFor(() => expect(editor().textContent).toContain('Original description'));
  });

  it('duplicates with the edited title, keeping a legacy description as plain text', async () => {
    const { onDuplicated, setOpen } = renderDialog();
    await waitFor(() => expect(editor()).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Pipelining Lab v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Duplicate' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/courses/c1/problems/p1/duplicate', {
        title: 'Pipelining Lab v2',
        // Untouched editor over a plain-text original: the copy stays PLAIN_TEXT.
        description: 'Original description',
      }),
    );
    expect(toastMock.duplicated).toHaveBeenCalled();
    expect(onDuplicated).toHaveBeenCalledWith({ id: 'p2' });
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('keeps a rich original rich in the copy without the author touching the editor', async () => {
    const descriptionJson = {
      version: 1,
      document: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rich original' }] }],
      },
    };
    renderDialog({ problem: { ...baseProblem, descriptionJson } });
    await waitFor(() => expect(editor()).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Create Duplicate' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        '/api/courses/c1/problems/p1/duplicate',
        expect.objectContaining({ descriptionJson }),
      ),
    );
  });

  it('blocks a too-short title with an inline error and no request', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'ab' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 3 characters/i);
    expect(screen.getByRole('button', { name: 'Create Duplicate' })).toBeDisabled();
    expect(postMock).not.toHaveBeenCalled();
  });
});
