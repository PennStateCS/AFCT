/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

import { AssignmentProblemSettingsDialog } from './AssignmentProblemSettingsDialog';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

import { toastMock } from '@/test/mocks/toast';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));
const toastSuccessMock = toastMock.success;
const toastErrorMock = toastMock.error;

vi.mock('@/components/ui/InputGroup', () => ({
  __esModule: true,
  default: ({
    label,
    name,
    value,
    setValue,
    type = 'text',
  }: {
    label: string;
    name: string;
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
        value={value ?? ''}
        onChange={(event) => setValue?.(event.target.value)}
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

const fetchMock = vi.fn();
const originalFetch = global.fetch;

/** The read the dialog does on open: current settings, plus how many attempts already exist. */
const settingsResponse = (over: Record<string, unknown> = {}) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({
      maxPoints: 10,
      maxSubmissions: 3,
      autograderEnabled: true,
      showFeedback: true,
      submissionCount: 0,
      ...over,
    }),
    text: async () =>
      JSON.stringify({
        maxPoints: 10,
        maxSubmissions: 3,
        autograderEnabled: true,
        showFeedback: true,
        submissionCount: 0,
        ...over,
      }),
  }) as unknown as Response;

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  // Default: the dialog's own GET succeeds and reports no attempts yet.
  fetchMock.mockResolvedValue(settingsResponse());
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});

afterAll(() => {
  global.fetch = originalFetch;
});

const renderDialog = () => {
  const setOpen = vi.fn();
  const onSaved = vi.fn();
  render(
    <AssignmentProblemSettingsDialog
      open
      setOpen={setOpen}
      courseId="course-1"
      assignmentId="assignment-1"
      problemId="problem-1"
      problemTitle="Sample Problem"
      settings={{ maxPoints: 10, maxSubmissions: 3, autograderEnabled: true }}
      courseIsArchived={false}
      onSaved={onSaved}
    />,
  );
  return { setOpen, onSaved };
};

describe('AssignmentProblemSettingsDialog', () => {
  it('PUTs the per-assignment link settings', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
      text: async () => JSON.stringify({ success: true }),
    } as unknown as Response);

    const { setOpen, onSaved } = renderDialog();

    // Autograder on by default; points/submissions seeded from settings.
    expect(screen.getByLabelText('Automatically Graded')).toBeChecked();
    fireEvent.change(screen.getByLabelText('Max Points'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Accepted Submissions'), { target: { value: '5' } });

    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/courses/course-1/assignments/assignment-1/problems/problem-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            maxPoints: 15,
            maxSubmissions: 5,
            autograderEnabled: true,
            showFeedback: true,
          }),
        }),
      ),
    );
    expect(toastMock.updated).toHaveBeenCalledWith('Problem settings');
    expect(onSaved).toHaveBeenCalled();
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('sends -1 for unlimited submissions', async () => {
    const user = userEvent.setup();

    renderDialog();

    await user.click(screen.getByRole('radio', { name: 'Unlimited' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Picked out by method rather than by position: the dialog also reads its current settings
    // when it opens, so the save is not the only request.
    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PUT',
      );
      expect(call).toBeDefined();
      return call!;
    });
    const body = JSON.parse((put[1] as RequestInit).body as string);
    expect(body.maxSubmissions).toBe(-1);
  });

  /**
   * Turning the switch when work already exists splits the class across two conditions, and a
   * student who has read the feedback cannot unread it. Allowed, but said out loud first.
   */
  it('warns before changing the feedback setting on a problem with attempts', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(settingsResponse({ submissionCount: 12 }));

    renderDialog();

    // Nothing to warn about until the switch actually moves.
    await waitFor(() => expect(screen.queryByText(/already been made/)).not.toBeInTheDocument());

    await user.click(screen.getByLabelText('Show Feedback to Students'));

    expect(
      await screen.findByText(/12 attempts have already been made with feedback shown/),
    ).toBeInTheDocument();
  });

  it('says nothing when no attempts exist yet', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(settingsResponse({ submissionCount: 0 }));

    renderDialog();
    await user.click(screen.getByLabelText('Show Feedback to Students'));

    expect(screen.queryByText(/already been made/)).not.toBeInTheDocument();
  });
});
