import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';

// The auth config and edge proxy now validate NEXTAUTH_SECRET at load/use time
// (requireAuthSecret). Provide a strong default for the suite; individual tests
// can still override it with vi.stubEnv (auto-restored via unstubEnvs).
process.env.NEXTAUTH_SECRET ??= 'test-nextauth-secret-at-least-32-characters-long';

// Polyfill ResizeObserver for Radix UI components (not available in jsdom)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let warnSpy: ReturnType<typeof vi.spyOn> | undefined;
let errorSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy?.mockRestore();
  errorSpy?.mockRestore();
});
