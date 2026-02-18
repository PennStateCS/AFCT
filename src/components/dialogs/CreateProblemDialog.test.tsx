/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { CreateProblemDialog } from './CreateProblemDialog';

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));
vi.mock('@/components/ui/InputGroup', () =>
  import('@/test/mocks/ui').then((mod) => mod.inputGroupMock),
);
vi.mock('@/components/ui/switch', () => import('@/test/mocks/ui').then((mod) => mod.switchMock));

const { showToastError } = vi.hoisted(() => ({
  showToastError: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showToast: {
    error: showToastError,
  },
}));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const originalFetch = global.fetch;
const fetchMock = vi.fn();

describe('CreateProblemDialog', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('submits problem details and uploads the file', async () => {
    const user = userEvent.setup();
    const setOpen = vi.fn();
    const onCreated = vi.fn();

    const file = new File(['test'], 'answer.jff', { type: 'text/plain' });

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'prob-1' }),
    } as Response);

    render(
      <CreateProblemDialog
        open
        setOpen={setOpen}
        courseId="course-1"
        courseIsArchived={false}
        onCreated={onCreated}
      />,
    );

    await user.type(screen.getByLabelText('Title'), 'DFA #1');
    await user.upload(screen.getByLabelText('Answer File'), file);

    await user.click(screen.getByRole('button', { name: 'Create Problem' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestInit.method).toBe('POST');

    const formData = requestInit.body as FormData;
    const payload: Record<string, FormDataEntryValue> = {};
    formData.forEach((value, key) => {
      payload[key] = value;
    });

    expect(payload).toMatchObject({
      title: 'DFA #1',
      courseId: 'course-1',
    });
    expect(payload.file).toBeInstanceOf(File);

    expect(onCreated).toHaveBeenCalledWith({ id: 'prob-1' });
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('prevents submission when the course is archived', async () => {
    const user = userEvent.setup();

    render(
      <CreateProblemDialog
        open
        setOpen={vi.fn()}
        courseId="course-1"
        courseIsArchived
        onCreated={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText('Title'), 'DFA #1');
    await user.upload(screen.getByLabelText('Answer File'), new File(['test'], 'answer.jff'));

    expect(screen.getByRole('button', { name: 'Create Problem' })).toBeDisabled();
  });
});
