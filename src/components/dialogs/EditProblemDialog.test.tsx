/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

vi.mock('@/hooks/useMaxUploadSize', () => ({
  useMaxUploadSize: () => ({ maxMb: 25, loading: false, error: null }),
}));

const clickNext = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Next' }));
};

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

const createJsonResponse = <T,>(data: T, ok = true, status = ok ? 200 : 400) =>
  Promise.resolve({
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
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

describe('EditProblemDialog (bank wizard)', () => {
  it('walks the wizard and PUTs only the problem definition', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(createJsonResponse({ id: 'problem-1' }));

    const { setOpen, onSaved } = renderDialog();

    // Step 1: Details (title prefilled from the problem).
    expect(screen.getByLabelText('Title')).toHaveValue('Sample Problem');
    await clickNext(user); // -> Type
    await clickNext(user); // -> Answer File
    await clickNext(user); // -> Review

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/courses/course-1/problems/problem-1',
      expect.objectContaining({ method: 'PUT' }),
    );

    const formData = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(formData.get('title')).toBe('Sample Problem');
    expect(formData.get('type')).toBe('FA');
    // Per-assignment fields are no longer part of the bank edit.
    expect(formData.get('maxPoints')).toBeNull();
    expect(formData.get('maxSubmissions')).toBeNull();
    expect(formData.get('autograderEnabled')).toBeNull();

    expect(toastSuccessMock).toHaveBeenCalledWith('Problem updated.');
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'problem-1' }));
  });
});
