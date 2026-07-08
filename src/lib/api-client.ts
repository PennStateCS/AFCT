import createClient from 'openapi-fetch';
import type { paths } from '@/types/api';

/**
 * Typed API client generated from the OpenAPI spec (`src/types/api.ts`). Paths,
 * params, request bodies, and responses are all type-checked against the spec, so
 * a route-shape change surfaces as a compile error here rather than at runtime.
 *
 * Same-origin by default. Opt-in — existing hand-written `fetch` calls keep working.
 *
 * Example:
 *   const { data, error } = await api.GET('/api/courses/{id}', {
 *     params: { path: { id }, query: { view: 'summary' } },
 *   });
 *
 * Regenerate the types after changing a route's `@openapi` block: `npm run docs:types`.
 */
export const api = createClient<paths>({ baseUrl: '' });
