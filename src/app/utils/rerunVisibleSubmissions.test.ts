import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProblemSubmission } from '@/lib/problem-submission';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: toastMock }));

import { rerunVisibleSubmissions } from './rerunVisibleSubmissions';

const originalFetch = global.fetch;
const fetchMock = vi.fn();

const sub = (id: string) => ({ id }) as ProblemSubmission;

beforeEach(() => {
  fetchMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('rerunVisibleSubmissions', () => {
  it('does nothing when there are no submissions', async () => {
    const setRerunning = vi.fn();
    const fetchReviewData = vi.fn();

    await rerunVisibleSubmissions({ visibleSubmissions: [], setRerunning, fetchReviewData });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchReviewData).not.toHaveBeenCalled();
  });

  it('dedupes by id and reruns each unique submission once', async () => {
    fetchMock.mockResolvedValue({ ok: true } as Response);
    const setRerunning = vi.fn();
    const fetchReviewData = vi.fn().mockResolvedValue(undefined);

    await rerunVisibleSubmissions({
      visibleSubmissions: [sub('a'), sub('a'), sub('b')],
      setRerunning,
      fetchReviewData,
    });

    // a is deduped: two unique ids -> two POSTs.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes('a'))).toBe(true);
    expect(urls.some((u) => u.includes('b'))).toBe(true);
    expect(toastMock.success).toHaveBeenCalledWith('Visible submissions are being re-evaluated');
    expect(fetchReviewData).toHaveBeenCalledTimes(1);

    // Busy map set for both ids on start, cleared on finish.
    expect(setRerunning.mock.calls[0][0]({})).toEqual({ a: true, b: true });
    expect(setRerunning.mock.calls[1][0]({ a: true, b: true })).toEqual({ a: false, b: false });
  });

  it('reports a single failure with the singular message', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({ ok: false } as Response);
    const setRerunning = vi.fn();
    const fetchReviewData = vi.fn().mockResolvedValue(undefined);

    await rerunVisibleSubmissions({
      visibleSubmissions: [sub('a'), sub('b')],
      setRerunning,
      fetchReviewData,
    });

    expect(toastMock.error).toHaveBeenCalledWith('One submission failed to rerun.');
    expect(toastMock.success).not.toHaveBeenCalled();
    // Still refreshes so the UI reflects whatever did rerun.
    expect(fetchReviewData).toHaveBeenCalledTimes(1);
  });

  it('reports multiple failures with the plural, counted message', async () => {
    fetchMock.mockResolvedValue({ ok: false } as Response);
    const setRerunning = vi.fn();
    const fetchReviewData = vi.fn().mockResolvedValue(undefined);

    await rerunVisibleSubmissions({
      visibleSubmissions: [sub('a'), sub('b')],
      setRerunning,
      fetchReviewData,
    });

    expect(toastMock.error).toHaveBeenCalledWith('2 submissions failed to rerun.');
  });
});
