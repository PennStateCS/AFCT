/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

import { CreateCourseDialog } from './CreateCourseDialog';

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
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
  }) => (
    <label>
      {label}
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

const fillForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('Course Name'), 'Intro to Testing');
  await user.type(screen.getByLabelText('Course Code'), 'cmpsc 131');
  await user.type(screen.getByLabelText('Semester'), 'Fall 2025');
  const creditsInput = screen.getByLabelText('Credits');
  fireEvent.change(creditsInput, { target: { value: '4' } });

  fireEvent.change(screen.getByLabelText('Start Date & Time'), {
    target: { value: '2025-08-25T09:00' },
  });
  fireEvent.change(screen.getByLabelText('End Date & Time'), {
    target: { value: '2025-12-10T12:00' },
  });
  fireEvent.change(screen.getByLabelText('Self Registration Opens'), {
    target: { value: '2025-06-01T09:00' },
  });
  fireEvent.change(screen.getByLabelText('Self Registration Closes'), {
    target: { value: '2025-08-15T09:00' },
  });

  await user.click(screen.getByLabelText('Ada Lovelace'));
};

const renderDialog = (props: Partial<React.ComponentProps<typeof CreateCourseDialog>> = {}) => {
  const setOpen = vi.fn();
  const onSuccess = vi.fn();
  render(<CreateCourseDialog open setOpen={setOpen} onSuccess={onSuccess} {...props} />);
  return { setOpen, onSuccess };
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

describe('CreateCourseDialog', () => {
  it('submits the form and shows a success toast', async () => {
    const user = userEvent.setup();
    resolveFacultyRequest();
    fetchMock.mockResolvedValueOnce(createJsonResponse({ id: 'course-123' }));

    const { setOpen, onSuccess } = renderDialog();

    await screen.findByLabelText('Ada Lovelace');
    await fillForm(user);

    const submitButton = screen.getByRole('button', { name: /create course/i });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [, requestInit] = fetchMock.mock.calls[1];
    const payload = JSON.parse((requestInit as RequestInit).body as string);
    expect(payload).toMatchObject({
      name: 'Intro to Testing',
      code: 'CMPSC 131',
      credits: 4,
      registrationOpenAt: '2025-06-01T09:00',
      registrationCloseAt: '2025-08-15T09:00',
      instructorIds: ['faculty-1'],
    });

    expect(toastSuccessMock).toHaveBeenCalledWith('Course created successfully');
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalled();
  });

  it('shows an error toast when the API returns an error response', async () => {
    const user = userEvent.setup();
    resolveFacultyRequest();
    fetchMock.mockResolvedValueOnce(createJsonResponse({ message: 'Server exploded' }, false, 500));

    renderDialog();

    await screen.findByLabelText('Ada Lovelace');
    await fillForm(user);

    const submitButton = screen.getByRole('button', { name: /create course/i });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(toastErrorMock).toHaveBeenCalledWith('Server exploded');
  });

  it('notifies the user when faculty fetching fails', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({}, false, 500));
    renderDialog();

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('Failed to load faculty list.'),
    );
  });
});
