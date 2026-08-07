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

// Polyfill document.elementFromPoint (absent in jsdom) for ProseMirror/Tiptap: it calls
// posAtCoords on mousedown to map a click to a document position, and jsdom does no layout
// so it never implemented the hit-testing APIs. Returning null is the "no element here"
// answer ProseMirror already handles, which is enough for the editor to take focus.
if (typeof document !== 'undefined' && typeof document.elementFromPoint !== 'function') {
  Object.defineProperty(document, 'elementFromPoint', {
    writable: true,
    value: () => null,
  });
}

// Polyfill the geometry APIs on ranges and text nodes, also missing because jsdom does no
// layout. ProseMirror measures a text range when it scrolls the selection into view after a
// transaction; that happens outside any test's call stack, so the TypeError surfaces as an
// unhandled error and fails the run even when every assertion passed. Empty geometry is the
// honest answer for a document that was never laid out.
{
  const emptyRect = () => ({
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  type Measurable = { getClientRects: () => unknown; getBoundingClientRect: () => unknown };
  const patch = (proto: object | undefined) => {
    if (!proto) return;
    const target = proto as Measurable;
    if (typeof target.getClientRects !== 'function') {
      target.getClientRects = () => Object.assign([] as unknown[], { item: () => null });
    }
    if (typeof target.getBoundingClientRect !== 'function') {
      target.getBoundingClientRect = emptyRect;
    }
  };
  patch(typeof Range !== 'undefined' ? Range.prototype : undefined);
  patch(typeof Text !== 'undefined' ? Text.prototype : undefined);
}

// Polyfill matchMedia (absent in jsdom) for components that read it directly
// (useIsMobile) or transitively (react-resizable-panels' pointer check). Defaults
// to "does not match" so the desktop layout renders.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

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
