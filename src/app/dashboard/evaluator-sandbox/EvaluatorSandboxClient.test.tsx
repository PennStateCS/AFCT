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

/**
 * Put a file into one of the two upload inputs.
 *
 * The page checks the contents are a JFLAP model before accepting a file, which means reading
 * it, so this waits for the name to appear rather than returning while that is still in flight.
 * jsdom's File has no `text()`, so it is supplied here or every upload would be refused.
 */
const attach = async (labelText: RegExp, name: string) => {
  const input = screen.getByLabelText(labelText) as HTMLInputElement;
  const content = '<structure/>';
  const file = new File([content], name, { type: 'text/xml' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByTitle(name)).toBeInTheDocument();
};

const attachBoth = async () => {
  await attach(/answer file/i, 'answer.jff');
  await attach(/submission file/i, 'student.jff');
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EvaluatorSandboxClient', () => {
  it('will not run until both files are chosen', async () => {
    renderPage();

    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    await attach(/answer file/i, 'answer.jff');
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    await attach(/submission file/i, 'student.jff');
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled();
  });

  it('refuses a plain text file with a reason, and will not run with it', async () => {
    // #791. The docs promise this page applies the same rule as the problem bank, so a .txt
    // that is not a JFLAP model has to be turned away here, and say why.
    renderPage();

    const input = screen.getByLabelText(/answer file/i) as HTMLInputElement;
    const content = 'q0 -> q1 on a';
    const file = new File([content], 'answer.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/not a JFLAP model/i)).toBeInTheDocument();
    // The file was not kept, so the run is still gated on it.
    expect(screen.queryByTitle('answer.txt')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('says where the output will appear before anything has been run', () => {
    renderPage();

    // The result card is always on the page, so it is clear where the answer will land.
    // It used to appear only once a run had started, which left the page ending at Run.
    expect(screen.getByRole('heading', { name: 'Result' })).toBeInTheDocument();
    expect(screen.getByText('Run a test to see the evaluator output here.')).toBeInTheDocument();
  });

  it('sends the files and the FA settings the run needs', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => trial() });
    renderPage();
    await attachBoth();

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
    await attachBoth();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(form.get('maxStates')).toBeNull();
    expect(form.get('isDeterministic')).toBeNull();
  });

  it('says what it is waiting for while the run is queued', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => trial() });
    renderPage();
    await attachBoth();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    // Two elements carry this text on purpose: the visible one, and the screen-reader region
    // that also carries the verdict. `getAllByText` rather than `findByText`, which throws on
    // more than one match.
    await waitFor(() =>
      expect(screen.getAllByText('Waiting for a free evaluator.').length).toBeGreaterThan(0),
    );
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
    await attachBoth();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByText('Correct')).toBeInTheDocument();
    expect(
      screen.queryByText('Run a test to see the evaluator output here.'),
    ).not.toBeInTheDocument();
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
    await attachBoth();
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
    await attachBoth();

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
    await attachBoth();
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

/**
 * The verdict has to be said out loud.
 *
 * The live region used to carry only the step ("Finished."), while Correct or Not correct sat
 * in the card header outside it. Somebody using a screen reader could run a file and never be
 * told the answer, which is the only thing this page is for.
 */
describe('what a screen reader is told', () => {
  const liveRegion = () => document.querySelector('[role="status"][aria-live="polite"]');

  it('exists before a run starts, so the first message is announced', () => {
    renderPage();

    // Present and empty: a region inserted together with its first message is not reliably
    // announced, which is why it cannot be mounted with the result card.
    expect(liveRegion()).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('');
  });

  it('names the verdict, not just that the run finished', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => trial() }).mockResolvedValue({
      ok: true,
      json: async () => trial({ state: 'COMPLETED', correct: false }),
    });
    renderPage();
    await attachBoth();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(liveRegion()).toHaveTextContent(/Not correct/));
    // The step alone is what it used to say, and is not enough on its own.
    expect(liveRegion()).toHaveTextContent(/Finished/);
  });

  it('says so when the answer was right', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => trial() }).mockResolvedValue({
      ok: true,
      json: async () => trial({ state: 'COMPLETED', correct: true }),
    });
    renderPage();
    await attachBoth();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(liveRegion()).toHaveTextContent(/Correct/));
  });
});
