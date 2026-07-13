/**
 * Test helpers for invoking App Router route handlers.
 *
 * The handlers our `withAdminAuth` / `withCourseAuth` wrappers return have the
 * Next.js signature `(req, ctx)`, so a test that calls `GET(req)` (or `GET()`)
 * fails to type-check. These helpers supply the missing pieces:
 *   - `routeCtx({ id })` builds the `{ params }` context (params resolved async,
 *     matching Next 15), defaulting to no params for routes that take none.
 *   - `testRequest()` is a throwaway Request for handlers that ignore it.
 */
export function routeCtx<P extends Record<string, string>>(
  params: P = {} as P,
): { params: Promise<P> } {
  return { params: Promise.resolve(params) };
}

export function testRequest(url = 'http://localhost/test', init?: RequestInit): Request {
  return new Request(url, init);
}
