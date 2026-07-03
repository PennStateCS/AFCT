'use client';

import useSWR from 'swr';
import { emptyStringSymbol } from '@/lib/empty-string-notation';

const fetcher = (url: string): Promise<{ emptyStringNotation?: string } | null> =>
  fetch(url).then((r) => (r.ok ? r.json() : null));

/**
 * Resolve the empty-string display symbol (ε / λ) for a course, for use as the
 * JFF viewer's `epsSymbol`. Returns the default (ε) while loading, when no
 * courseId is provided, or if the lookup fails. Uses SWR so multiple viewers on
 * the same course share a single request.
 */
export function useEmptyStringSymbol(courseId?: string | null): string {
  const { data } = useSWR(courseId ? `/api/courses/${courseId}?view=basic` : null, fetcher);
  return emptyStringSymbol(data?.emptyStringNotation);
}
