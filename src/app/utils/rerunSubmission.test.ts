import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Submission } from '@prisma/client';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: toastMock }));

import { rerunSubmission } from './rerunSubmission';

const originalFetch = global.fetch;
const fetchMock = vi.fn();

const submission = { id: 's1' } as Submission;

beforeEach(() => {
  fetchMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('rerunSubmission', () => {
  it('does nothing when the submission has no id', async () => {
    const setRerunning = vi.fn();
    const fetchReviewData = vi.fn();

    await rerunSubmission({ submission: {} as Submission, setRerunning, fetchReviewData });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(setRerunning).not.toHaveBeenCalled();
    expect(fetchReviewData).not.toHaveBeenCalled();
  });

  it('reruns, toasts success, refreshes, and toggles the busy flag on then off', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const setRerunning = vi.fn();
    const fetchReviewData = vi.fn().mockResolvedValue(undefined);

    await rerunSubmission({ submission, setRerunning, fetchReviewData });

    expect(fetchMock.mock.calls[0][0]).toContain('s1');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(toastMock.success).toHaveBeenCalledWith('Submission re-evaluated');
    expect(fetchReviewData).toHaveBeenCalledTimes(1);

    // The busy map flips true (start) then false (finally).
    expect(setRerunning).toHaveBeenCalledTimes(2);
    expect(setRerunning.mock.calls[0][0]({})).toEqual({ s1: true });
    expect(setRerunning.mock.calls[1][0]({ s1: true })).toEqual({ s1: false });
  });

  it('toasts the server error message and does not refresh on failure', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'nope' }) } as Response);
    const setRerunning = vi.fn();
    const fetchReviewData = vi.fn();

    await rerunSubmission({ submission, setRerunning, fetchReviewData });

    expect(toastMock.error).toHaveBeenCalledWith('nope');
    expect(fetchReviewData).not.toHaveBeenCalled();
    // The flag is still reset in the finally block.
    expect(setRerunning.mock.calls[1][0]({ s1: true })).toEqual({ s1: false });
    errSpy.mockRestore();
  });
});
