/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportAssignmentDialog } from './ImportAssignmentDialog';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/fetch-client', () => ({
  apiClient: { get: getMock, post: postMock },
  ApiError: class ApiError extends Error {},
}));
import { toastMock } from '@/test/mocks/toast';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

// Replace the Radix-based SelectField with a native <select> so the wizard is drivable
// in jsdom (Radix Select's portal/pointer model doesn't work headlessly).
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
const assignments = [
  { id: 'a1', title: 'Pipelining Lab', description: 'Original desc', problemCount: 2 },
];

const renderDialog = () => {
  const onImported = vi.fn();
  const setOpen = vi.fn();
  render(
    <ImportAssignmentDialog
      open
      setOpen={setOpen}
      courseId="dest"
      courseIsArchived={false}
      onImported={onImported}
    />,
  );
  return { onImported, setOpen };
};

describe('ImportAssignmentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes('manageable-courses') ? courses : assignments),
    );
    postMock.mockResolvedValue({ id: 'a2' });
  });

  it('loads manageable courses (excluding the destination) on open', async () => {
    renderDialog();
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith('/api/me/manageable-courses?excludeCourseId=dest'),
    );
  });

  it('walks source → details → problems → review and imports with the chosen options', async () => {
    const { onImported } = renderDialog();

    // Step 1: pick the source course, then its assignment.
    const courseSelect = await screen.findByLabelText('Course to import from');
    fireEvent.change(courseSelect, { target: { value: 'src' } });
    const assignmentSelect = await screen.findByLabelText('Assignment to import');
    fireEvent.change(assignmentSelect, { target: { value: 'a1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Step 2: title prefilled from the source assignment.
    await waitFor(() =>
      expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Pipelining Lab'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Step 3: problem options (copy is the default).
    expect(screen.getByText('Copy the problems into this course')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Step 4: review, then import.
    fireEvent.click(screen.getByRole('button', { name: 'Import Assignment' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/courses/dest/assignments/import', {
        sourceCourseId: 'src',
        sourceAssignmentId: 'a1',
        title: 'Pipelining Lab',
        description: 'Original desc',
        problemMode: 'copy',
      }),
    );
    expect(toastMock.imported).toHaveBeenCalledWith('Assignment');
    expect(onImported).toHaveBeenCalledWith({ id: 'a2' });
  });

  it('warns that a group source assignment will become individual', async () => {
    getMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('manageable-courses')
          ? courses
          : [
              {
                id: 'g1',
                title: 'Team Project',
                description: null,
                problemCount: 0,
                isGroup: true,
              },
            ],
      ),
    );
    renderDialog();

    fireEvent.change(await screen.findByLabelText('Course to import from'), {
      target: { value: 'src' },
    });
    fireEvent.change(await screen.findByLabelText('Assignment to import'), {
      target: { value: 'g1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent(/group assignment/i));
    expect(screen.getByRole('note')).toHaveTextContent(/individual assignment/i);
  });
});
