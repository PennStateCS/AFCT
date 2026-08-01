/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DuplicateAssignmentDialog } from './DuplicateAssignmentDialog';

const postMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/fetch-client', () => ({
  apiClient: { post: postMock },
  ApiError: class ApiError extends Error {},
}));
import { toastMock } from '@/test/mocks/toast';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

const baseAssignment = {
  id: 'a1',
  title: 'Pipelining Lab',
  description: 'Original description',
  isGroup: false,
  problemCount: 2,
};

const renderDialog = (
  over: Partial<React.ComponentProps<typeof DuplicateAssignmentDialog>> = {},
) => {
  const onDuplicated = vi.fn();
  const setOpen = vi.fn();
  render(
    <DuplicateAssignmentDialog
      open
      setOpen={setOpen}
      courseId="c1"
      courseIsArchived={false}
      assignment={baseAssignment}
      onDuplicated={onDuplicated}
      {...over}
    />,
  );
  return { onDuplicated, setOpen };
};

describe('DuplicateAssignmentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postMock.mockResolvedValue({ id: 'a2' });
  });

  it('prefills the title from the source and lets you edit it', async () => {
    renderDialog();
    const title = screen.getByLabelText('Title') as HTMLInputElement;
    expect(title.value).toBe('Pipelining Lab');
    fireEvent.change(title, { target: { value: 'Pipelining Lab v2' } });
    expect(title.value).toBe('Pipelining Lab v2');
  });

  it('offers the three problem options and duplicates with the chosen mode', async () => {
    const { onDuplicated } = renderDialog();

    // Step 1: details -> Next.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Step 2: the three problem choices.
    expect(screen.getByText("Don't include problems")).toBeInTheDocument();
    expect(screen.getByText('Link the same problems')).toBeInTheDocument();
    expect(screen.getByText('Duplicate the problems')).toBeInTheDocument();
    // Pick "link" (default is duplicate).
    fireEvent.click(screen.getByRole('radio', { name: /Link the same problems/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Step 3: review notes the unpublished behaviour.
    expect(screen.getByText(/created/i)).toHaveTextContent(/unpublished/i);

    fireEvent.click(screen.getByRole('button', { name: 'Create Duplicate' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/courses/c1/assignments/a1/duplicate', {
        title: 'Pipelining Lab',
        description: 'Original description',
        problemMode: 'link',
      }),
    );
    expect(toastMock.duplicated).toHaveBeenCalledWith('Assignment', {
      name: 'Pipelining Lab',
    });
    expect(onDuplicated).toHaveBeenCalledWith({ id: 'a2' });
  });

  it('keeps a rich original rich in the copy without the author touching the editor', async () => {
    const descriptionJson = {
      version: 1,
      document: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rich original' }] }],
      },
    };
    renderDialog({ assignment: { ...baseAssignment, descriptionJson } });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Duplicate' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        '/api/courses/c1/assignments/a1/duplicate',
        expect.objectContaining({ descriptionJson }),
      ),
    );
    // The plain text is derived server-side from the document, so it is not sent.
    expect(postMock.mock.calls[0][1].description).toBeUndefined();
  });

  it('sends problemMode none and shows an empty-state when there are no problems', async () => {
    renderDialog({ assignment: { ...baseAssignment, problemCount: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/no problems, so there is nothing to copy/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Duplicate' }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        '/api/courses/c1/assignments/a1/duplicate',
        expect.objectContaining({ problemMode: 'none' }),
      ),
    );
  });
});
