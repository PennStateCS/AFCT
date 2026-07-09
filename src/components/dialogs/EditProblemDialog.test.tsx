/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { Problem } from '@prisma/client';

import { EditProblemDialog } from './EditProblemDialog';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showToast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

vi.mock('@/components/ui/InputGroup', () => ({
  __esModule: true,
  // Mirror the real InputGroup's two APIs: RHF `fieldProps`, and the
  // controlled `value`/`setValue` pair used by the assignment-override fields.
  default: ({
    label,
    name,
    fieldProps = {},
    value,
    setValue,
    type = 'text',
    ...rest
  }: {
    label: string;
    name: string;
    fieldProps?: {
      value?: string;
      onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
      onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
    };
    value?: string;
    setValue?: (val: string) => void;
    type?: string;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        name={name}
        type={type}
        value={value ?? fieldProps?.value ?? ''}
        onChange={(event) => {
          if (setValue) setValue(event.target.value);
          else fieldProps?.onChange?.(event);
        }}
        onBlur={(event) => fieldProps?.onBlur?.(event)}
        {...rest}
      />
    </label>
  ),
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    id,
    checked,
    onCheckedChange,
  }: {
    id?: string;
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
  }) => (
    <input
      type="checkbox"
      role="switch"
      id={id}
      checked={!!checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

vi.mock('@/components/ui/dialog', () => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Wrapper,
    DialogContent: Wrapper,
    DialogHeader: Wrapper,
    DialogTitle: Wrapper,
    DialogDescription: Wrapper,
    DialogFooter: Wrapper,
    DialogClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const baseProblem = {
  id: 'problem-1',
  title: 'Sample Problem',
  description: 'desc',
  type: 'FA',
  maxStates: 5,
  isDeterministic: true,
  fileName: null,
  originalFileName: null,
  courseId: 'course-1',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-02T00:00:00Z'),
} as unknown as Problem;

const defaultAssignmentSettings = {
  assignmentId: 'assignment-1',
  courseId: 'course-1',
  maxPoints: 10,
  maxSubmissions: 3,
  autograderEnabled: true,
};

const createJsonResponse = <T,>(data: T, ok = true) =>
  Promise.resolve({
    ok,
    json: async () => data,
  } as unknown as Response);

const fetchMock = vi.fn();
const originalFetch = global.fetch;

const renderDialog = (props: Partial<React.ComponentProps<typeof EditProblemDialog>> = {}) => {
  const setOpen = vi.fn();
  const onSaved = vi.fn();
  render(
    <EditProblemDialog
      open
      courseIsArchived={false}
      setOpen={setOpen}
      onSaved={onSaved}
      problem={baseProblem}
      {...props}
    />,
  );
  return { setOpen, onSaved };
};

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('EditProblemDialog assignment settings', () => {
  it('submits assignment overrides when settings change', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({ id: 'problem-1' }))
      .mockResolvedValueOnce(createJsonResponse({ success: true }));

    const { setOpen, onSaved } = renderDialog({ assignmentSettings: defaultAssignmentSettings });

    const pointsInput = screen.getByLabelText('Max Points');
    const submissionsInput = screen.getByLabelText('Max Submissions');
    // automatic grading toggle should be present and checked by default
    expect(screen.getByLabelText('Automatic Grading')).toBeInTheDocument();
    expect(screen.getByLabelText('Automatic Grading')).toBeChecked();
    fireEvent.change(pointsInput, { target: { value: '15' } });
    fireEvent.change(submissionsInput, { target: { value: '5' } });

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/courses/course-1/problems/problem-1',
      expect.objectContaining({ method: 'PUT' }),
    );
    // ensure updated fields are sent in form data
    const firstCallArgs = fetchMock.mock.calls[0][1] as RequestInit;
    const formData = firstCallArgs.body as FormData;
    expect(formData.get('maxSubmissions')).toBe('5');
    expect(formData.get('maxPoints')).toBe('15');

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/courses/course-1/assignments/assignment-1/problems/problem-1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          maxPoints: 15,
          maxSubmissions: 5,
          autograderEnabled: true,
        }),
      }),
    );

    expect(toastSuccessMock).toHaveBeenCalledWith('Problem updated.');
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'problem-1' }));
  });

  it('skips assignment override request when overrides are unchanged', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(createJsonResponse({ id: 'problem-1' }));

    renderDialog({ assignmentSettings: defaultAssignmentSettings });

    const titleInput = screen.getByLabelText('Title');
    await user.type(titleInput, ' Updated');

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/courses/course-1/problems/problem-1',
      expect.objectContaining({ method: 'PUT' }),
    );
    // when only title changed, max fields remain untouched (they use defaults)
    const onlyCallArgs = fetchMock.mock.calls[0][1] as RequestInit;
    const fd2 = onlyCallArgs.body as FormData;
    expect(fd2.get('maxSubmissions')).toBeTruthy();
    expect(fd2.get('maxPoints')).toBeTruthy();
  });
});
