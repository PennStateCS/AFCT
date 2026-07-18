/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

import { EditAssignmentDialog } from './EditAssignmentDialog';
import type { Assignment } from '@prisma/client';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const { toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showToast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

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

const baseAssignment: Assignment = {
  id: 'assignment-1',
  title: 'Original Title',
  description: 'Old description',
  dueDate: new Date('2026-09-01T23:59:00Z'),
  isPublished: false,
  isGroup: false,
  allowLateSubmissions: true,
  lateCutoff: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  courseId: 'course-123',
};

const originalFetch = global.fetch;
const fetchMock = vi.fn();

const createJsonResponse = <T,>(data: T, ok = true, status = 200) =>
  Promise.resolve({
    ok,
    status,
    json: async () => data,
  } as Response);

const renderDialog = (props: Partial<React.ComponentProps<typeof EditAssignmentDialog>> = {}) => {
  const setOpen = vi.fn();
  const onSave = vi.fn();
  render(
    <EditAssignmentDialog
      open
      courseIsArchived={false}
      setOpen={setOpen}
      onSave={onSave}
      assignment={baseAssignment}
      timeZone="America/New_York"
      {...props}
    />,
  );
  return { setOpen, onSave };
};

const makeDirty = async (user: ReturnType<typeof userEvent.setup>) => {
  const titleInput = screen.getByLabelText('Title');
  await user.type(titleInput, ' Updated');
};

beforeEach(() => {
  fetchMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('EditAssignmentDialog', () => {
  it('submits updates and closes dialog on success', async () => {
    const user = userEvent.setup();
    const updatedAssignment = {
      ...baseAssignment,
      title: 'Original Title Updated',
      isPublished: true,
    };
    fetchMock.mockResolvedValueOnce(createJsonResponse(updatedAssignment));

    // Render with an explicit cutoff so the field is pre-populated (no auto-fill).
    const { setOpen, onSave } = renderDialog({
      assignment: { ...baseAssignment, lateCutoff: new Date('2026-09-05T23:59:00Z') },
    });

    const cutoffInput = screen.getByLabelText(/Late Submission Cutoff/);
    const expectedCutoffValue = (cutoffInput as HTMLInputElement).value;
    expect(expectedCutoffValue).not.toBe('');

    await makeDirty(user);
    await user.click(screen.getByLabelText('Publish Now'));

    const submitButton = screen.getByRole('button', { name: /save changes/i });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [requestUrl, requestInit] = fetchMock.mock.calls[0];
    expect(requestUrl).toBe('/api/courses/course-123/assignments/assignment-1');

    const payload = JSON.parse((requestInit as RequestInit).body as string);
    expect(payload).toMatchObject({
      title: 'Original Title Updated',
      description: baseAssignment.description,
      courseId: baseAssignment.courseId,
      isPublished: true,
      allowLateSubmissions: true,
    });
    expect(payload.lateCutoff).toBe(expectedCutoffValue);

    expect(onSave).toHaveBeenCalledWith(updatedAssignment);
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('sends null cutoff when late submissions are disabled', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(createJsonResponse(baseAssignment));

    renderDialog();

    await makeDirty(user);
    await user.click(screen.getByLabelText('Allow Late Submissions'));

    await waitFor(() => expect(screen.queryByLabelText('Late Submission Cutoff')).toBeNull());

    const submitButton = screen.getByRole('button', { name: /save changes/i });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, requestInit] = fetchMock.mock.calls[0];
    const payload = JSON.parse((requestInit as RequestInit).body as string);
    expect(payload).toMatchObject({ allowLateSubmissions: false });
    expect(payload.lateCutoff).toBeNull();
  });

  it('leaves the cutoff empty when enabling late submissions (no auto-fill)', async () => {
    const user = userEvent.setup();

    renderDialog({
      assignment: { ...baseAssignment, allowLateSubmissions: false, lateCutoff: null },
    });

    expect(screen.queryByLabelText(/Late Submission Cutoff/)).toBeNull();

    await user.click(screen.getByLabelText('Allow Late Submissions'));

    // The cutoff is optional (blank = no deadline), so the field appears empty rather
    // than being auto-populated with the due date.
    const cutoffInput = await screen.findByLabelText(/Late Submission Cutoff/);
    expect((cutoffInput as HTMLInputElement).value).toBe('');
  });

  it('shows a toast when the API errors', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(createJsonResponse({ error: 'Nope' }, false, 400));

    const { onSave, setOpen } = renderDialog();

    await makeDirty(user);

    const submitButton = screen.getByRole('button', { name: /save changes/i });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(toastErrorMock).toHaveBeenCalledWith('Nope');
    expect(onSave).not.toHaveBeenCalled();
    expect(setOpen).not.toHaveBeenCalledWith(false);
  });

  it('prevents submission when the course is archived', async () => {
    const user = userEvent.setup();
    renderDialog({ courseIsArchived: true });

    await makeDirty(user);

    const submitButton = screen.getByRole('button', { name: /save changes/i });
    await waitFor(() => expect(submitButton).toBeDisabled());
    await user.click(submitButton);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
