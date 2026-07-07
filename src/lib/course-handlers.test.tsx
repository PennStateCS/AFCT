/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const utils = vi.hoisted(() => ({
  deleteItem: vi.fn(),
  updateCourseAfterDelete: vi.fn((c: unknown) => c),
  updateCourseAfterAssignmentSave: vi.fn((c: unknown) => c),
  updateCourseAfterAssignmentPublish: vi.fn((c: unknown) => c),
  updateCourseAfterProblemSave: vi.fn((c: unknown) => c),
  updateCourseAfterAssignmentCreate: vi.fn((c: unknown) => c),
  updateCourseAfterProblemCreate: vi.fn((c: unknown) => c),
  updateAssignmentPublishStatus: vi.fn(),
  updateCoursePublishStatus: vi.fn(),
  updateCourseArchiveStatus: vi.fn(),
  saveCourse: vi.fn(),
}));
vi.mock('@/lib/course-utils', () => utils);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: toastMock }));

import { useCourseHandlers } from '@/lib/course-handlers';

const course = { id: 'c1', startDate: new Date('2026-01-01'), endDate: new Date('2026-05-01') } as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('useCourseHandlers — assignment publish toggle', () => {
  it('updates the publish status and course state on success', async () => {
    utils.updateAssignmentPublishStatus.mockResolvedValue(undefined);
    const setCourse = vi.fn();
    const { result } = renderHook(() => useCourseHandlers(course, setCourse));
    await act(async () => {
      await result.current.handleAssignmentPublishToggle('a1', true);
    });
    expect(utils.updateAssignmentPublishStatus).toHaveBeenCalledWith('a1', true);
    expect(setCourse).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('toasts an error and does not throw when the update fails', async () => {
    utils.updateAssignmentPublishStatus.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useCourseHandlers(course, vi.fn()));
    await act(async () => {
      await result.current.handleAssignmentPublishToggle('a1', true);
    });
    expect(toastMock.error).toHaveBeenCalled();
  });
});

describe('useCourseHandlers — course save', () => {
  it('persists and confirms the save', async () => {
    utils.saveCourse.mockResolvedValue({ name: 'New name' });
    const setCourse = vi.fn();
    const { result } = renderHook(() => useCourseHandlers(course, setCourse));
    await act(async () => {
      await result.current.handleCourseSave({ name: 'New name' });
    });
    expect(utils.saveCourse).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('Course updated!');
  });

  it('toasts a failure when the save rejects', async () => {
    utils.saveCourse.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useCourseHandlers(course, vi.fn()));
    await act(async () => {
      await result.current.handleCourseSave({ name: 'x' });
    });
    expect(toastMock.error).toHaveBeenCalledWith('Failed to save course');
  });
});

describe('useCourseHandlers — optimistic state updates', () => {
  it('applies an assignment save to course state', async () => {
    const setCourse = vi.fn();
    const { result } = renderHook(() => useCourseHandlers(course, setCourse));
    await act(async () => {
      await result.current.handleAssignmentSave({ id: 'a1' } as never);
    });
    expect(utils.updateCourseAfterAssignmentSave).toHaveBeenCalled();
    expect(setCourse).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('Assignment updated!');
  });

  it('applies an assignment creation to course state', () => {
    const setCourse = vi.fn();
    const { result } = renderHook(() => useCourseHandlers(course, setCourse));
    act(() => result.current.handleAssignmentCreate({ id: 'a2' } as never));
    expect(utils.updateCourseAfterAssignmentCreate).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('Assignment created!');
  });

  it('applies a problem creation to course state', () => {
    const setCourse = vi.fn();
    const { result } = renderHook(() => useCourseHandlers(course, setCourse));
    act(() => result.current.handleProblemCreated({ id: 'p1' } as never));
    expect(utils.updateCourseAfterProblemCreate).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('Problem created!');
  });

  it('ignores a problem creation with no problem payload', () => {
    const setCourse = vi.fn();
    const { result } = renderHook(() => useCourseHandlers(course, setCourse));
    act(() => result.current.handleProblemCreated(undefined));
    expect(utils.updateCourseAfterProblemCreate).not.toHaveBeenCalled();
    expect(setCourse).not.toHaveBeenCalled();
  });

  it('applies a problem save to course state', () => {
    const setCourse = vi.fn();
    const { result } = renderHook(() => useCourseHandlers(course, setCourse));
    act(() => result.current.handleProblemSaved({ id: 'p1' } as never));
    expect(utils.updateCourseAfterProblemSave).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('Problem updated!');
  });

  it('is a no-op for edit/delete click handlers except returning their argument', () => {
    const { result } = renderHook(() => useCourseHandlers(course, vi.fn()));
    expect(result.current.handleAssignmentEditClick({ id: 'a1' } as never)).toEqual({ id: 'a1' });
    expect(result.current.handleAssignmentDeleteClick('a1')).toBe('a1');
    expect(result.current.handleProblemEditClick({ id: 'p1' } as never)).toEqual({ id: 'p1' });
    expect(result.current.handleProblemDeleteClick('p1')).toBe('p1');
  });
});

describe('useCourseHandlers — course publish/archive toggles', () => {
  it('publishes the course and confirms', async () => {
    utils.updateCoursePublishStatus.mockResolvedValue({ isPublished: true });
    const setCourse = vi.fn();
    const { result } = renderHook(() => useCourseHandlers(course, setCourse));
    await act(async () => {
      await result.current.handleCoursePublishToggle(true);
    });
    expect(utils.updateCoursePublishStatus).toHaveBeenCalledWith('c1', true);
    expect(toastMock.success).toHaveBeenCalledWith('Course published');
  });

  it('toasts when publishing fails', async () => {
    utils.updateCoursePublishStatus.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useCourseHandlers(course, vi.fn()));
    await act(async () => {
      await result.current.handleCoursePublishToggle(true);
    });
    expect(toastMock.error).toHaveBeenCalled();
  });

  it('archives the course and confirms', async () => {
    utils.updateCourseArchiveStatus.mockResolvedValue({ isArchived: true });
    const setCourse = vi.fn();
    const { result } = renderHook(() => useCourseHandlers(course, setCourse));
    await act(async () => {
      await result.current.handleCourseArchiveToggle(true);
    });
    expect(utils.updateCourseArchiveStatus).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('Course archived');
  });

  it('toasts when archiving fails', async () => {
    utils.updateCourseArchiveStatus.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useCourseHandlers(course, vi.fn()));
    await act(async () => {
      await result.current.handleCourseArchiveToggle(true);
    });
    expect(toastMock.error).toHaveBeenCalled();
  });
});

describe('useCourseHandlers — delete', () => {
  it('deletes a problem and confirms', async () => {
    utils.deleteItem.mockResolvedValue(undefined);
    const setCourse = vi.fn();
    const { result } = renderHook(() => useCourseHandlers(course, setCourse));
    await act(async () => {
      await result.current.handleDelete({ id: 'p1', type: 'problem' });
    });
    expect(utils.deleteItem).toHaveBeenCalled();
    expect(setCourse).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('Problem deleted');
  });

  it('toasts an error when the delete fails', async () => {
    utils.deleteItem.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useCourseHandlers(course, vi.fn()));
    await act(async () => {
      await result.current.handleDelete({ id: 'p1', type: 'problem' });
    });
    expect(toastMock.error).toHaveBeenCalledWith('Error deleting item');
  });
});
