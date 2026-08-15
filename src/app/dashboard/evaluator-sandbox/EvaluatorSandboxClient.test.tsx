/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EvaluatorSandboxClient from './EvaluatorSandboxClient';

vi.mock('@/hooks/use-max-upload-size', () => ({
  useMaxUploadSize: () => ({ maxMb: 25, loading: false, error: null }),
}));

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <EvaluatorSandboxClient />
    </QueryClientProvider>,
  );
};

const trial = (over: Record<string, unknown> = {}) => ({
  id: 'trial-1',
  state: 'PENDING',
  problemType: 'FA',
  maxStates: null,
  isDeterministic: false,
  answerFile: 'answer.jff',
  submissionFile: 'student.jff',
  correct: null,
  feedback: null,
  evaluationRaw: null,
  stderr: null,
  durationMs: null,
  createdAt: '2026-08-14T12:00:00.000Z',
  startedAt: null,
  completedAt: null,
  expiresAt: '2026-08-14T13:00:00.000Z',
  ...over,
});

const fetchMock = vi.fn();

/** Put a file into one of the two upload inputs. */
const attach = (labelText: RegExp, name: string) => {
  const input = screen.getByLabelText(labelText) as HTMLInputElement;
  const file = new File(['<structure/>'], name, { type: 'text/xml' });
  fireEvent.change(input, { target: { files: [file] } });
};

const attachBoth = () => {
  attach(/answer file/i, 'answer.jff');
  attach(/submission file/i, 'student.jff');
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EvaluatorSandboxClient', () => {
  it('will not run until both files are chosen', () => {
    renderPage();

    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    attach(/answer file/i, 'answer.jff');
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    attach(/submission file/i, 'student.jff');
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled();
  });

  it('sends the files and the FA settings the run needs', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => trial() });
    renderPage();
    attachBoth();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/evaluator-trials');
    const form = init.body as FormData;
    expect(form.get('type')).toBe('FA');
    // Unlimited is the default, and the evaluator spells that -1.
    expect(form.get('maxStates')).toBe('-1');
    expect(form.get('isDeterministic')).toBe('false');
    expect((form.get('answerFile') as File).name).toBe('answer.jff');
    expect((form.get('submissionFile') as File).name).toBe('student.jff');
  });

  it('omits the state bound for a type that has none', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => trial({ problemType: 'CFG' }) });
    renderPage();
    fireEvent.change(screen.getByLabelText(/problem type/i), { target: { value: 'CFG' } });
    attachBoth();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(form.get('maxStates')).toBeNull();
    expect(form.get('isDeterministic')).toBeNull();
  });

  it('says what it is waiting for while the run is queued', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => trial() });
    renderPage();
    attachBoth();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByText('Waiting for a free evaluator.')).toBeInTheDocument();
  });

  it('shows the verdict, the runtime and the raw output once it finishes', async () => {
    const finished = trial({
      state: 'COMPLETED',
      correct: true,
      feedback: 'Accepted',
      durationMs: 812,
      evaluationRaw: { correct: true, feedback: 'Accepted' },
    });
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? { ok: true, json: async () => trial() }
        : { ok: true, json: async () => finished },
    );
    renderPage();
    attachBoth();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByText('Correct')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText('812 ms')).toBeInTheDocument();
    expect(screen.getByText('Full evaluator output')).toBeInTheDocument();
  });

  it('marks a run that could not happen as such, rather than as a wrong answer', async () => {
    const failed = trial({
      state: 'FAILED',
      correct: null,
      feedback: 'The evaluator could not run: Evaluation timed out',
      durationMs: 5000,
    });
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? { ok: true, json: async () => trial() }
        : { ok: true, json: async () => failed },
    );
    renderPage();
    attachBoth();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByText('Did not run')).toBeInTheDocument();
    expect(
      screen.getByText('The evaluator could not run: Evaluation timed out'),
    ).toBeInTheDocument();
  });

  it('shows the server’s reason when the trial is refused', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'You already have a trial running. Wait for it to finish.' }),
    });
    renderPage();
    attachBoth();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(
      await screen.findByText('You already have a trial running. Wait for it to finish.'),
    ).toBeInTheDocument();
  });

  it('discards the trial when it is cleared, so the uploads go now', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? { ok: true, json: async () => trial() }
        : { ok: true, json: async () => trial({ state: 'COMPLETED', correct: false }) },
    );
    renderPage();
    attachBoth();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await screen.findByText('Not correct');

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === '/api/evaluator-trials/trial-1' && init?.method === 'DELETE',
        ),
      ).toBe(true),
    );
  });
});
