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
 * down numbers that are meant to be tuned by eye. What each drawing IS, and whether a file
 * is fit to inline, belongs to the loader and is tested in src/lib/auth-automata.test.ts.
 */

/** Stand-ins for the files in public/auth-automata, distinguishable by their circle. */
const automata = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `automaton-${i}`,
    markup: `<svg viewBox="0 0 10 10"><circle r="${i}" /></svg>`,
  }));

const FIVE = automata(5);

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

/**
 * Which drawing is showing, by the only thing that distinguishes them in the DOM.
 *
 * The opacity is on the wrapper rather than on the svg: the drawings are inlined from files,
 * so nothing can put a class on them.
 */
const activeIndex = (container: HTMLElement) => {
  // The wrapper's own children, not a `div div` query: testing-library renders into a div of
  // its own, so a descendant selector picks the wrapper up as well and shifts every index.
  const slides = [...(container.firstElementChild?.children ?? [])];
  return slides.findIndex((d) => d.getAttribute('class')?.includes('opacity-100'));
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
  it('renders every drawing it is given and opens on the first', () => {
    const { container } = render(<RotatingAuthAutomaton automata={FIVE} />);

    expect(container.querySelectorAll('svg')).toHaveLength(5);
    expect(activeIndex(container)).toBe(0);
  });

  it('inlines the markup from the file rather than linking to it', () => {
    const { container } = render(<RotatingAuthAutomaton automata={automata(1)} />);

    // The drawing is really in the document, so a file using currentColor can inherit the
    // panel's tint. An <img> would render it in its own colours and this would find nothing.
    expect(container.querySelector('svg circle')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('advances one step per interval and wraps back round', () => {
    const { container } = render(<RotatingAuthAutomaton automata={FIVE} />);

    for (const expected of [1, 2, 3, 4, 0]) {
      act(() => void vi.advanceTimersByTime(ROTATION_MS));
      expect(activeIndex(container)).toBe(expected);
    }
  });

  it('wraps at however many files there are, not at five', () => {
    const { container } = render(<RotatingAuthAutomaton automata={automata(2)} />);

    for (const expected of [1, 0, 1]) {
      act(() => void vi.advanceTimersByTime(ROTATION_MS));
      expect(activeIndex(container)).toBe(expected);
    }
  });

  it('stays on the first diagram for the whole interval', () => {
    const { container } = render(<RotatingAuthAutomaton automata={FIVE} />);

    act(() => void vi.advanceTimersByTime(ROTATION_MS - 1));

    expect(activeIndex(container)).toBe(0);
  });

  it('draws nothing at all when the folder is empty', () => {
    const { container } = render(<RotatingAuthAutomaton automata={[]} />);

    // Not an empty box holding the space open: nothing.
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a single drawing without starting a timer', () => {
    const { container } = render(<RotatingAuthAutomaton automata={automata(1)} />);

    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not move at all when the reader has asked for reduced motion', () => {
    setReducedMotion(true);
    const { container } = render(<RotatingAuthAutomaton automata={FIVE} />);

    act(() => void vi.advanceTimersByTime(ROTATION_MS * 4));

    expect(activeIndex(container)).toBe(0);
  });

  it('does not advance a picture in a background tab', () => {
    setVisibility('hidden');
    const { container } = render(<RotatingAuthAutomaton automata={FIVE} />);

    act(() => void vi.advanceTimersByTime(ROTATION_MS * 3));
    expect(activeIndex(container)).toBe(0);

    // Coming back starts a fresh countdown rather than replaying what was missed.
    setVisibility('visible');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    act(() => void vi.advanceTimersByTime(ROTATION_MS));
    expect(activeIndex(container)).toBe(1);
  });

  it('stops when the tab is hidden mid-run', () => {
    const { container } = render(<RotatingAuthAutomaton automata={FIVE} />);

    act(() => void vi.advanceTimersByTime(ROTATION_MS));
    expect(activeIndex(container)).toBe(1);

    setVisibility('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    act(() => void vi.advanceTimersByTime(ROTATION_MS * 3));

    expect(activeIndex(container)).toBe(1);
  });

  it('leaves no timer or listener behind', () => {
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<RotatingAuthAutomaton automata={FIVE} />);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('says nothing to a screen reader', () => {
    const { container } = render(<RotatingAuthAutomaton automata={FIVE} />);

    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    // On the wrapper, which hides the whole stack: the drawings are inlined from files and
    // cannot be relied on to carry the attribute themselves.
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
