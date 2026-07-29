/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DuplicateProblemDialog } from './DuplicateProblemDialog';

const postMock = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/fetch-client', () => ({
  apiClient: { post: postMock },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/toast', () => ({
  showToast: { success: toastSuccess, error: toastError },
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
    postMock.mockResolvedValue({ id: 'p2' });
  });

  it('prefills the title and description from the source', () => {
    renderDialog();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Pipelining Lab');
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe(
      'Original description',
    );
  });

  it('duplicates with the edited title/description and reports the new problem', async () => {
    const { onDuplicated, setOpen } = renderDialog();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Pipelining Lab v2' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Problem' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/courses/c1/problems/p1/duplicate', {
        title: 'Pipelining Lab v2',
        description: 'Edited',
      }),
    );
    expect(onDuplicated).toHaveBeenCalledWith({ id: 'p2' });
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('blocks a too-short title with an inline error and no request', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'ab' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 3 characters/i);
    expect(screen.getByRole('button', { name: 'Duplicate Problem' })).toBeDisabled();
    expect(postMock).not.toHaveBeenCalled();
  });
});
