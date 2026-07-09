/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

import { CreateAssignmentDialog } from './CreateAssignmentDialog';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

vi.mock('@/components/ui/InputGroup', () => ({
  __esModule: true,
  default: ({
    label,
    name,
    fieldProps = {},
    type = 'text',
  }: {
    label: string;
    name: string;
    fieldProps?: {
      value?: string;
      onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
      onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
    };
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

const originalFetch = global.fetch;
const fetchMock = vi.fn();

const createJsonResponse = <T,>(data: T, ok = true, status = 200) =>
  Promise.resolve({
    ok,
    status,
    json: async () => data,
  } as Response);

const renderDialog = (props: Partial<React.ComponentProps<typeof CreateAssignmentDialog>> = {}) => {
  const setOpen = vi.fn();
  const onCreate = vi.fn();
  render(
    <CreateAssignmentDialog
      open
      courseId="course-123"
      courseIsArchived={false}
      setOpen={setOpen}
      onCreate={onCreate}
      timeZone="America/New_York"
      {...props}
    />,
  );
  return { setOpen, onCreate };
};

const fillRequiredFields = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('Title'), 'Homework 1');
  await user.type(
    screen.getByPlaceholderText('Enter assignment description'),
    'Practice finite automata',
  );
  fireEvent.change(screen.getByLabelText('Due Date & Time'), {
    target: { value: '2026-09-01T23:59' },
  });
};

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('CreateAssignmentDialog', () => {
  it('submits assignment details and closes dialog on success', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(createJsonResponse({ id: 'assignment-1' }));

    const { setOpen, onCreate } = renderDialog();

    await fillRequiredFields(user);
    await user.click(screen.getByLabelText('Publish Now'));

    const submitButton = screen.getByRole('button', { name: /create assignment/i });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [requestUrl, requestInit] = fetchMock.mock.calls[0];
    expect(requestUrl).toBe('/api/courses/course-123/assignments');

    const payload = JSON.parse((requestInit as RequestInit).body as string);
    expect(payload).toMatchObject({
      title: 'Homework 1',
      description: 'Practice finite automata',
      dueDate: '2026-09-01T23:59',
      courseId: 'course-123',
      isPublished: true,
    });

    expect(setOpen).toHaveBeenCalledWith(false);
    expect(onCreate).toHaveBeenCalledWith({ id: 'assignment-1' });
  });

  it('logs an error when the API call fails', async () => {
    const user = userEvent.setup();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(createJsonResponse({ message: 'Nope' }, false, 500));

    const { onCreate, setOpen } = renderDialog();

    await fillRequiredFields(user);

    const submitButton = screen.getByRole('button', { name: /create assignment/i });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(onCreate).not.toHaveBeenCalled();
    expect(setOpen).not.toHaveBeenCalledWith(false);
    expect(errorSpy).toHaveBeenCalledWith('Failed to create assignment:', 'Nope');
    errorSpy.mockRestore();
  });

  it('disables submission when the course is archived', async () => {
    const user = userEvent.setup();
    renderDialog({ courseIsArchived: true });

    await fillRequiredFields(user);

    const submitButton = screen.getByRole('button', { name: /create assignment/i });
    await waitFor(() => expect(submitButton).toBeDisabled());
    await user.click(submitButton);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
