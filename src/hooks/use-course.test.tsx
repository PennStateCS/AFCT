/** @vitest-environment jsdom */
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// A fresh QueryClient per test so the course cache never leaks between cases.
// retry:false keeps failure paths fast; gcTime:0 avoids lingering cache.
const createWrapper = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
};

const replaceMock = vi.fn();
const searchParamsMock = { get: vi.fn(), toString: vi.fn(() => '') };
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => searchParamsMock,
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: toastMock }));

import { useCourseData, useTabNavigation, useDialogStates, useEnrollment } from '@/hooks/use-course';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  searchParamsMock.get.mockReturnValue(null);
  searchParamsMock.toString.mockReturnValue('');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDialogStates', () => {
  it('starts with every dialog closed and no pending targets', () => {
    const { result } = renderHook(() => useDialogStates());
    expect(result.current.editOpen).toBe(false);
    expect(result.current.confirmOpen).toBe(false);
    expect(result.current.pendingDelete).toBeNull();
    expect(result.current.allUsers).toEqual([]);
  });

  it('exposes working setters', () => {
    const { result } = renderHook(() => useDialogStates());
    act(() => result.current.setEditOpen(true));
    expect(result.current.editOpen).toBe(true);
  });
});

describe('useTabNavigation', () => {
  it('defaults to the assignments tab', () => {
    const { result } = renderHook(() => useTabNavigation());
    expect(result.current.tab).toBe('assignments');
  });

  it('reads the initial tab from the query string', () => {
    searchParamsMock.get.mockReturnValue('roster');
    const { result } = renderHook(() => useTabNavigation());
    expect(result.current.tab).toBe('roster');
  });

  it('updates state and rewrites the URL on change', () => {
    const { result } = renderHook(() => useTabNavigation());
    act(() => result.current.handleTabChange('problems'));
    expect(result.current.tab).toBe('problems');
    expect(replaceMock).toHaveBeenCalledWith('?tab=problems');
  });
});

describe('useCourseData', () => {
  it('fetches the course summary on mount when none is provided', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'c1', name: 'X', enrolled: [], assignments: [], problems: [] }),
    });
    const { result } = renderHook(() => useCourseData('c1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.course).not.toBeNull());
    expect(result.current.course?.id).toBe('c1');
    expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1?view=summary');
  });

  it('does not fetch when an initial course is supplied', async () => {
    const initialCourse = { id: 'c1', name: 'X', assignments: [{}], problems: [], enrolled: [] } as never;
    renderHook(() => useCourseData('c1', { initialCourse }), { wrapper: createWrapper() });
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a toast when the course fetch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    renderHook(() => useCourseData('c1'), { wrapper: createWrapper() });
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Failed to load course'));
  });

  it('lazily loads the assignments section and merges it into the course', async () => {
    const initialCourse = { id: 'c1', name: 'X', assignments: [], problems: [], enrolled: [] } as never;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ assignments: [{ id: 'a1' }] }) });
    const { result } = renderHook(() => useCourseData('c1', { initialCourse }), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.loadTabData('assignments');
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1?view=assignments');
    expect(result.current.course?.assignments).toEqual([{ id: 'a1' }]);
  });

  it('lazily loads the roster tab', async () => {
    const initialCourse = { id: 'c1', name: 'X', assignments: [], problems: [], enrolled: [] } as never;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ enrolled: [{ id: 'u1' }] }) });
    const { result } = renderHook(() => useCourseData('c1', { initialCourse }), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.loadTabData('roster');
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1?view=roster');
    expect(result.current.course?.enrolled).toEqual([{ id: 'u1' }]);
  });

  it('fetches the full view (not summary) for a student on mount', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'c1', name: 'X', enrolled: [], assignments: [], problems: [] }),
    });
    renderHook(() => useCourseData('c1', { isStudent: true }), { wrapper: createWrapper() });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1?view=full'));
  });

  it('does not lazily load tabs for a student (they already have full data)', async () => {
    const initialCourse = { id: 'c1', name: 'X', assignments: [{}], problems: [], enrolled: [] } as never;
    const { result } = renderHook(() => useCourseData('c1', { initialCourse, isStudent: true }), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.loadTabData('assignments');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useEnrollment', () => {
  it('filters out users already enrolled in the course', async () => {
    const course = { enrolled: [{ id: 'u1' }] } as never;
    fetchMock.mockResolvedValue({ ok: true, json: async () => [{ id: 'u1' }, { id: 'u2' }] });
    const { result } = renderHook(() => useEnrollment(course));
    let available: Array<{ id: string }> = [];
    await act(async () => {
      available = await result.current.fetchAvailableUsers();
    });
    expect(available.map((u) => u.id)).toEqual(['u2']);
  });

  it('posts an enrollment and refetches on success', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const refetch = vi.fn();
    const { result } = renderHook(() => useEnrollment(null));
    await act(async () => {
      await result.current.handleEnrollUser({ id: 'u9' } as never, 'c1', refetch);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/courses/c1/enroll',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(toastMock.success).toHaveBeenCalledWith('User enrolled!');
    expect(refetch).toHaveBeenCalled();
  });

  it('toasts an error when enrollment fails', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    const { result } = renderHook(() => useEnrollment(null));
    await act(async () => {
      await result.current.handleEnrollUser({ id: 'u9' } as never, 'c1', vi.fn());
    });
    expect(toastMock.error).toHaveBeenCalledWith('Error enrolling user');
  });
});
