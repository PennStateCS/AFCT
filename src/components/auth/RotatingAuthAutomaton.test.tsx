/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RotatingAuthAutomaton } from './RotatingAuthAutomaton';

/**
 * The rotation, not the drawings.
 *
 * What matters here is that the page is still when somebody asks for stillness, still when
 * nobody is looking, and that it never leaves a timer behind. The diagrams themselves are
 * appearance and are checked in a browser; asserting their coordinates here would only pin
 * down numbers that are meant to be tuned by eye.
 */

const setReducedMotion = (reduce: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
};

/** Which of the five is showing, by the only thing that distinguishes them in the DOM. */
const activeIndex = (container: HTMLElement) => {
  const diagrams = [...container.querySelectorAll('svg')];
  return diagrams.findIndex((d) => d.getAttribute('class')?.includes('opacity-100'));
};

const ROTATION_MS = 150_000;

beforeEach(() => {
  vi.useFakeTimers();
  setReducedMotion(false);
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the rotating decorative automaton', () => {
  it('renders all five and opens on the first', () => {
    const { container } = render(<RotatingAuthAutomaton />);

    expect(container.querySelectorAll('svg')).toHaveLength(5);
    expect(activeIndex(container)).toBe(0);
  });

  it('advances one step per interval and wraps back round', () => {
    const { container } = render(<RotatingAuthAutomaton />);

    for (const expected of [1, 2, 3, 4, 0]) {
      act(() => void vi.advanceTimersByTime(ROTATION_MS));
      expect(activeIndex(container)).toBe(expected);
    }
  });

  it('stays on the first diagram for the whole interval', () => {
    const { container } = render(<RotatingAuthAutomaton />);

    act(() => void vi.advanceTimersByTime(ROTATION_MS - 1));

    expect(activeIndex(container)).toBe(0);
  });

  it('does not move at all when the reader has asked for reduced motion', () => {
    setReducedMotion(true);
    const { container } = render(<RotatingAuthAutomaton />);

    act(() => void vi.advanceTimersByTime(ROTATION_MS * 4));

    expect(activeIndex(container)).toBe(0);
  });

  it('does not advance a picture in a background tab', () => {
    setVisibility('hidden');
    const { container } = render(<RotatingAuthAutomaton />);

    act(() => void vi.advanceTimersByTime(ROTATION_MS * 3));
    expect(activeIndex(container)).toBe(0);

    // Coming back starts a fresh countdown rather than replaying what was missed.
    setVisibility('visible');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    act(() => void vi.advanceTimersByTime(ROTATION_MS));
    expect(activeIndex(container)).toBe(1);
  });

  it('stops when the tab is hidden mid-run', () => {
    const { container } = render(<RotatingAuthAutomaton />);

    act(() => void vi.advanceTimersByTime(ROTATION_MS));
    expect(activeIndex(container)).toBe(1);

    setVisibility('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    act(() => void vi.advanceTimersByTime(ROTATION_MS * 3));

    expect(activeIndex(container)).toBe(1);
  });

  it('leaves no timer or listener behind', () => {
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<RotatingAuthAutomaton />);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('says nothing to a screen reader', () => {
    const { container } = render(<RotatingAuthAutomaton />);

    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
