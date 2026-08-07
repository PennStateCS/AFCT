import { vi } from 'vitest';

/**
 * A stand-in for `showToast` with every helper stubbed.
 *
 * Hand-rolled `vi.mock('@/lib/toast', ...)` factories only listed the two or three helpers the
 * test happened to assert on, so adding one helper to the real module turned every unrelated
 * call to it into "showToast.updated is not a function" across a dozen suites. Listing them
 * once here means a new helper is wired up in one place.
 *
 * Vitest gives each test file its own module registry, so these spies are per-file and do not
 * leak between suites. Reset them in `beforeEach` with `resetToastMock()`.
 *
 * Usage, matching the `@/test/mocks/ui` pattern:
 *
 *   vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));
 *   import { toastMock, resetToastMock } from '@/test/mocks/toast';
 */
export const toastMock = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),

  created: vi.fn(),
  updated: vi.fn(),
  deleted: vi.fn(),
  added: vi.fn(),
  removed: vi.fn(),
  duplicated: vi.fn(),
  imported: vi.fn(),
  saved: vi.fn(),

  validationError: vi.fn(),
  networkError: vi.fn(),
  unauthorized: vi.fn(),
  serverError: vi.fn(),

  update: vi.fn(),
  dismiss: vi.fn(),
};

/** What the `vi.mock('@/lib/toast', ...)` factory should resolve to. */
export const toastModuleMock = { showToast: toastMock };

/** Clear every spy. Call from `beforeEach` so one test's toasts do not bleed into the next. */
export function resetToastMock() {
  for (const fn of Object.values(toastMock)) fn.mockReset();
}
