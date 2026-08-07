/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportProblemDialog } from './ImportProblemDialog';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/fetch-client', () => ({
  apiClient: { get: getMock, post: postMock },
  ApiError: class ApiError extends Error {},
}));
import { toastMock } from '@/test/mocks/toast';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

// Native <select> stand-in so the wizard is drivable in jsdom (Radix Select's
// portal/pointer model doesn't work headlessly).
vi.mock('@/components/ui/SelectField', () => ({
  default: ({
    label,
    value,
    onValueChange,
    options,
    disabled,
  }: {
    label: string;
    value?: string;
    onValueChange?: (v: string) => void;
    options?: { value: string; label: React.ReactNode }[];
    disabled?: boolean;
  }) => (
    <select
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      <option value="" />
      {options?.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const courses = [
  { id: 'src', name: 'Theory', code: 'CS 301', semester: 'Spring 2026', isArchived: false },
];
const problems = [{ id: 'p1', title: 'Pipelining Lab', description: 'Original desc', type: 'FA' }];

const renderDialog = () => {
  const onImported = vi.fn();
  const setOpen = vi.fn();
  render(
    <ImportProblemDialog
      open
      setOpen={setOpen}
      courseId="dest"
      courseIsArchived={false}
      onImported={onImported}
    />,
  );
  return { onImported, setOpen };
};

describe('ImportProblemDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes('manageable-courses') ? courses : problems),
    );
    postMock.mockResolvedValue({ id: 'p2' });
  });

  it('loads manageable courses (excluding the destination) on open', async () => {
    renderDialog();
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith('/api/me/manageable-courses?excludeCourseId=dest'),
    );
  });

  it('walks source → details → review and imports the chosen problem', async () => {
    const { onImported } = renderDialog();

    fireEvent.change(await screen.findByLabelText('Course to import from'), {
      target: { value: 'src' },
    });
    fireEvent.change(await screen.findByLabelText('Problem to import'), {
      target: { value: 'p1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() =>
      expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Pipelining Lab'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    fireEvent.click(screen.getByRole('button', { name: 'Import Problem' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/courses/dest/problems/import', {
        sourceCourseId: 'src',
        sourceProblemId: 'p1',
        title: 'Pipelining Lab',
        description: 'Original desc',
      }),
    );
    expect(toastMock.imported).toHaveBeenCalledWith('Problem');
    expect(onImported).toHaveBeenCalledWith({ id: 'p2' });
  });
});
