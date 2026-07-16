import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';

// The auth config and edge proxy now validate NEXTAUTH_SECRET at load/use time
// (requireAuthSecret). Provide a strong default for the suite; individual tests
// can still override it with vi.stubEnv (auto-restored via unstubEnvs).
process.env.NEXTAUTH_SECRET ??= 'test-nextauth-secret-at-least-32-characters-long';

// next/font loaders are build-time SWC transforms and don't run under vitest.
// Stub every font export (Geist, Open_Sans, whatever fonts.ts points at this
// week) with a loader that returns the usual shape.
vi.mock('next/font/google', () => {
  return new Proxy(
    {},
    {
      // vitest checks exports with `in` before reading them.
      has: () => true,
      get: (_target, prop) => {
        // Symbols and promise/module-shape probes must NOT get a function back,
        // or the mocked namespace looks like a thenable and awaits forever.
        if (typeof prop !== 'string' || prop === 'then' || prop === 'default' || prop === '__esModule') {
          return undefined;
        }
        return () => ({
          className: `mock-font-${prop}`,
          variable: `--mock-font-${prop}`,
          style: { fontFamily: prop },
        });
      },
    },
  );
});

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
