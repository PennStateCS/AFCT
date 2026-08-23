/** @vitest-environment jsdom */

import React from 'react';
import { act, render } from '@testing-library/react';
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Does Light / Dark / System actually work?
 *
 * The existing ThemeToggle and Navbar tests mock `next-themes` away, so they prove the
 * click wiring (setTheme is called with the right string) and nothing about the result.
 * This drives the REAL provider with the same props RootProviders passes, and asserts on
 * the `.dark` class that every `dark:` utility in the app keys off, plus the `color-scheme`
 * that native controls (the mobile section select, scrollbars) read.
 */

// A controllable prefers-color-scheme, since jsdom has no matchMedia at all.
let osPrefersDark = false;
const listeners = new Set<(e: MediaQueryListEvent) => void>();

const installMatchMedia = () => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      media: query,
      matches: query.includes('dark') ? osPrefersDark : false,
      onchange: null,
      addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.add(l),
      removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.delete(l),
      addListener: (l: (e: MediaQueryListEvent) => void) => listeners.add(l),
      removeListener: (l: (e: MediaQueryListEvent) => void) => listeners.delete(l),
      dispatchEvent: () => false,
    }),
  });
};

/** Flip the OS preference and tell the listeners, the way the browser would. */
const setOsDark = (dark: boolean) => {
  osPrefersDark = dark;
  act(() => {
    listeners.forEach((l) => l({ matches: dark } as MediaQueryListEvent));
  });
};

const isDark = () => document.documentElement.classList.contains('dark');
const isHighContrast = () => document.documentElement.classList.contains('high-contrast');
const colorScheme = () => document.documentElement.style.colorScheme;

function Harness({ initial }: { initial?: string }) {
  const { setTheme } = useTheme();
  React.useEffect(() => {
    if (initial) setTheme(initial);
  }, [initial, setTheme]);
  return null;
}

// The exact props RootProviders uses. If those change, this test should be revisited.
const renderThemed = (initial?: string) =>
  render(
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      themes={['light', 'dark', 'high-contrast']}
    >
      <Harness initial={initial} />
    </NextThemesProvider>,
  );

beforeEach(() => {
  listeners.clear();
  osPrefersDark = false;
  installMatchMedia();
  window.localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.style.colorScheme = '';
});

afterEach(() => {
  document.documentElement.className = '';
});

describe('theme modes', () => {
  it('light removes the dark class', () => {
    osPrefersDark = true; // even with a dark OS, an explicit choice wins
    renderThemed('light');
    expect(isDark()).toBe(false);
    expect(colorScheme()).toBe('light');
  });

  it('dark applies the dark class', () => {
    renderThemed('dark');
    expect(isDark()).toBe(true);
    expect(colorScheme()).toBe('dark');
  });

  it('system follows a dark OS', () => {
    osPrefersDark = true;
    renderThemed('system');
    expect(isDark()).toBe(true);
  });

  it('system follows a light OS', () => {
    osPrefersDark = false;
    renderThemed('system');
    expect(isDark()).toBe(false);
  });

  it('system keeps following the OS after it changes', () => {
    osPrefersDark = false;
    renderThemed('system');
    expect(isDark()).toBe(false);

    setOsDark(true);
    expect(isDark()).toBe(true);

    setOsDark(false);
    expect(isDark()).toBe(false);
  });

  it('an explicit choice stops following the OS', () => {
    renderThemed('dark');
    expect(isDark()).toBe(true);
    // The OS going light must not undo an explicit "dark".
    setOsDark(false);
    expect(isDark()).toBe(true);
  });

  it('remembers the choice across a remount', () => {
    const { unmount } = renderThemed('dark');
    expect(isDark()).toBe(true);
    unmount();
    document.documentElement.className = '';

    renderThemed();
    expect(isDark()).toBe(true);
  });

  it('high contrast applies its own class and NOT the dark one', () => {
    renderThemed('high-contrast');
    expect(isHighContrast()).toBe(true);
    // This matters more than it looks: high contrast derives from light, so every `dark:`
    // utility in the app must stay switched off. If .dark landed here too, half the app
    // would render dark-mode overrides on a white page.
    expect(isDark()).toBe(false);
    // next-themes only sets color-scheme for the names light and dark, so the block sets
    // it; without that a native <select> keeps whatever the previous theme left behind.
    expect(colorScheme()).toBe('light');
  });

  it('high contrast ignores the OS preference, like any explicit choice', () => {
    osPrefersDark = true;
    renderThemed('high-contrast');
    expect(isHighContrast()).toBe(true);
    expect(isDark()).toBe(false);

    setOsDark(false);
    expect(isHighContrast()).toBe(true);
  });

  it('switching away from high contrast clears its class', () => {
    const { unmount } = renderThemed('high-contrast');
    expect(isHighContrast()).toBe(true);
    unmount();
    document.documentElement.className = '';

    renderThemed('dark');
    expect(isHighContrast()).toBe(false);
    expect(isDark()).toBe(true);
  });

  it('remembers high contrast across a remount', () => {
    const { unmount } = renderThemed('high-contrast');
    expect(isHighContrast()).toBe(true);
    unmount();
    document.documentElement.className = '';

    renderThemed();
    expect(isHighContrast()).toBe(true);
  });

  it('defaults a first-time visitor to light, NOT to their OS setting', () => {
    // Pinning current behaviour, not endorsing it: RootProviders passes
    // defaultTheme="light" alongside enableSystem, so someone whose OS is dark still
    // lands on light until they pick System themselves. defaultTheme="system" is the
    // usual pairing; changing it is a product decision, so this test records what is.
    osPrefersDark = true;
    renderThemed();
    expect(isDark()).toBe(false);
  });
});
