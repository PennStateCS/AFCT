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
vi.mock('@/hooks/useMaxUploadSize', () => ({
  useMaxUploadSize: () => {
    // Mock the hook but don't call fetch in the hook
    return { maxMb: 25, loading: false, error: null };
  },
}));

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

const clickNext = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Next' }));
};

describe('CreateProblemDialog', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('walks the wizard, uploads the file, and submits on review', async () => {
    const user = userEvent.setup();
    const setOpen = vi.fn();
    const onCreated = vi.fn();

    // Must be valid XML/JFLAP content; the dialog rejects non-XML files.
    const fileContent = '<structure><type>FA</type></structure>';
    const file = new File([fileContent], 'answer.jff', { type: 'text/plain' });
    // jsdom's File doesn't implement text(); the dialog uses it to validate.
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(fileContent) });

    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/system-settings/public')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ maxUploadSizeMb: 25, sessionTimeoutMinutes: 20 }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ id: 'prob-1' }),
        text: async () => JSON.stringify({ id: 'prob-1' }),
      } as unknown as Response);
    });

    render(
      <CreateProblemDialog
        open
        setOpen={setOpen}
        courseId="course-1"
        courseIsArchived={false}
        onCreated={onCreated}
      />,
    );

    // Step 1: Details
    await user.type(screen.getByLabelText('Title'), 'DFA #1');
    await clickNext(user);

    // Step 2: Type (autograder on by default)
    expect(screen.getByLabelText('Automatically Graded')).toBeInTheDocument();
    expect(screen.getByLabelText('Automatically Graded')).toBeChecked();
    await clickNext(user);

    // Step 3: Answer File
    const fileInput = document.getElementById('answer-file') as HTMLInputElement;
    await user.upload(fileInput, file);

    // The file onChange validates asynchronously (reads the file text), so wait for the
    // Next button to enable (it is gated on a file being present) before advancing.
    const nextButton = screen.getByRole('button', { name: 'Next' });
    await waitFor(() => expect(nextButton).toBeEnabled());
    await user.click(nextButton);

    // Step 4: Review + submit
    const createButton = screen.getByRole('button', { name: 'Create Problem' });
    await waitFor(() => expect(createButton).toBeEnabled());
    await user.click(createButton);

    // One call for problem creation (useMaxUploadSize is mocked and doesn't fetch)
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
    expect(onCreated).toHaveBeenCalledWith({ id: 'prob-1' }, true);
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('disables the answer-file upload when the course is archived', async () => {
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

    // Advance to the Answer File step.
    await user.type(screen.getByLabelText('Title'), 'DFA #1');
    await clickNext(user);
    await clickNext(user);

    const fileInput = document.getElementById('answer-file') as HTMLInputElement;
    expect(fileInput).toBeDisabled();
  });
});
