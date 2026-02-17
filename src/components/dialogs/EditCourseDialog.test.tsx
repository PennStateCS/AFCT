/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

import { EditCourseDialog } from './EditCourseDialog';
import type { Course } from '@prisma/client';
import type { EnrolledUser } from '@/lib/course-utils';

const { toastErrorMock, showToastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  showToastErrorMock: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
  },
}));

vi.mock('@/lib/toast', () => ({
  showToast: {
    error: showToastErrorMock,
  },
}));

vi.mock('@/components/ui/InputGroup', () => ({
  __esModule: true,
  default: ({
    label,
    name,
    fieldProps = {},
    error,
    type = 'text',
    requiredMark,
    ...rest
  }: {
    label: string;
    name: string;
    fieldProps?: {
      value?: string;
      onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
      onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
    };
    error?: string;
    type?: string;
    requiredMark?: boolean;
  }) => (
    <label>
      {label}
      {requiredMark ? '*' : null}
      <input
        aria-label={label}
        name={name}
        type={type}
        value={fieldProps?.value ?? ''}
        onChange={(event) => fieldProps?.onChange?.(event)}
        onBlur={(event) => fieldProps?.onBlur?.(event)}
        {...rest}
      />
      {error ? (
        <span role="alert" aria-live="assertive">
          {error}
        </span>
      ) : null}
    </label>
  ),
}));

vi.mock('@/components/ui/SearchableMultiSelect', () => ({
  SearchableMultiSelect: ({
    label,
    items,
    value = [],
    onChange,
    error,
  }: {
    label: string;
    items: Array<{ id: string; label: string }>;
    value: string[];
    onChange: (next: string[]) => void;
    error?: string;
  }) => (
    <fieldset>
      <legend>{label}</legend>
      {items.map((item) => {
        const checked = value.includes(item.id);
        return (
          <label key={item.id}>
            <input
              type="checkbox"
              aria-label={item.label}
              checked={checked}
              onChange={() => {
                const next = new Set(value);
                if (next.has(item.id)) {
                  next.delete(item.id);
                } else {
                  next.add(item.id);
                }
                onChange(Array.from(next));
              }}
            />
            {item.label}
          </label>
        );
      })}
      {error ? (
        <span role="alert" aria-live="assertive">
          {error}
        </span>
      ) : null}
    </fieldset>
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

const originalFetch = global.fetch;
const fetchMock = vi.fn();

const createJsonResponse = <T,>(data: T, ok = true, status = 200) =>
  Promise.resolve({
    ok,
    status,
    json: async () => data,
  } as Response);

const resolveFacultyRequest = () =>
  fetchMock.mockResolvedValueOnce(
    createJsonResponse([
      { id: 'faculty-1', firstName: 'Ada', lastName: 'Lovelace', role: 'FACULTY' },
      { id: 'faculty-2', firstName: 'Alan', lastName: 'Turing', role: 'FACULTY' },
    ]),
  );

const baseCourse: Course & { enrolled: EnrolledUser[] } = {
  id: 'course-1',
  name: 'Software Engineering',
  code: 'CMPSC 431',
  credits: 3,
  semester: 'Spring 2025',
  startDate: new Date('2025-01-10T14:00:00Z'),
  endDate: new Date('2025-04-20T16:00:00Z'),
  registrationOpenAt: new Date('2024-11-01T12:00:00Z'),
  registrationCloseAt: new Date('2024-12-15T12:00:00Z'),
  isPublished: true,
  isArchived: false,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
  regCode: 'ABC123',
  isSelfRegistrationEnabled: true,
  maxFileSizeMb: 10,
  timezone: 'America/New_York',
  enrolled: [
    {
      id: 'faculty-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      courseRole: 'FACULTY',
    },
  ],
};

const renderDialog = (props: Partial<React.ComponentProps<typeof EditCourseDialog>> = {}) => {
  const setOpen = vi.fn();
  const onSave = vi.fn();
  const course = props.course ?? baseCourse;
  render(
    <EditCourseDialog
      course={course}
      open
      setOpen={setOpen}
      onSave={onSave}
      timeZone="America/New_York"
      {...props}
    />,
  );
  return { setOpen, onSave };
};

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  toastErrorMock.mockReset();
  showToastErrorMock.mockReset();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('EditCourseDialog', () => {
  it('submits updates and closes the dialog on success', async () => {
    resolveFacultyRequest();
    fetchMock.mockResolvedValueOnce(createJsonResponse({ id: 'course-1' }));

    const user = userEvent.setup();
    const { setOpen, onSave } = renderDialog();

    await screen.findByLabelText('Ada Lovelace');

    const nameInput = screen.getByLabelText('Course Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Advanced Software Engineering');

    const registrationCloseInput = screen.getByLabelText('Self Registration Closes');
    await user.clear(registrationCloseInput);
    await user.type(registrationCloseInput, '2024-12-20T12:00');

    const submitButton = screen.getByRole('button', { name: /save changes/i });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, requestInit] = fetchMock.mock.calls[1];
    const payload = JSON.parse((requestInit as RequestInit).body as string);

    expect(payload).toMatchObject({
      id: 'course-1',
      name: 'Advanced Software Engineering',
      code: 'CMPSC 431',
      registrationCloseAt: '2024-12-20T12:00',
    });

    expect(showToastErrorMock).not.toHaveBeenCalled();
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(onSave).toHaveBeenCalledWith({ id: 'course-1' });
  });

  it('shows an error toast when the update request fails', async () => {
    resolveFacultyRequest();
    fetchMock.mockResolvedValueOnce(createJsonResponse({ message: 'Save failed' }, false, 500));

    const user = userEvent.setup();
    const { setOpen, onSave } = renderDialog();

    await screen.findByLabelText('Ada Lovelace');

    const nameInput = screen.getByLabelText('Course Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Broken Update');

    const submitButton = screen.getByRole('button', { name: /save changes/i });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(showToastErrorMock).toHaveBeenCalledWith('Save failed');
    expect(setOpen).not.toHaveBeenCalledWith(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('notifies when faculty list fails to load', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({}, false, 500));
    renderDialog();

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('Failed to load faculty list.'),
    );
  });
});
