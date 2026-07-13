// src/lib/errors.ts
//
// Small, isomorphic error helpers shared by server and client code. Keeping the
// "normalize an unknown catch value into a string" logic in one place replaces the
// `err instanceof Error ? err.message : '…'` ternary that was copy-pasted across
// dozens of route handlers, workers, and UI components.

/**
 * Normalize an unknown thrown value into a human-readable message. `catch` gives us
 * `unknown`, so every call site otherwise re-implements the same `instanceof Error`
 * narrowing. Pass `fallback` for the non-Error case (a plain string thrown, etc.).
 */
export function errMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}
