'use client';

import { useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useSession } from 'next-auth/react';
import { retryUnlessClientError } from '@/lib/query-fetch';

/**
 * Clears the entire query cache whenever the signed-in identity changes — a
 * different user id or a change to their admin flag — and on sign-out. The
 * cache holds user- and role-specific data (courses, rosters, grades, admin
 * lists), so a stale entry must never survive a user switch or a privilege
 * change and be shown to the next identity. Today a normal logout also hard-
 * reloads the page (see `safe-signout`), which discards the cache; this makes
 * that guarantee explicit and also covers in-place changes (e.g. an admin flag
 * flipping on the hourly session refresh) that don't reload.
 */
export function CacheResetOnIdentityChange() {
  const queryClient = useQueryClient();
  const { data, status } = useSession();
  const identity =
    status === 'authenticated' && data?.user
      ? `${data.user.id}:${data.user.isAdmin ? 1 : 0}`
      : status === 'unauthenticated'
        ? null
        : undefined; // 'loading' — don't decide yet

  const prev = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (identity === undefined) return; // still resolving the session
    if (prev.current === undefined) {
      // First settled read: the cache was just created for this identity, so
      // record the baseline without clearing.
      prev.current = identity;
      return;
    }
    if (prev.current !== identity) {
      queryClient.clear();
      prev.current = identity;
    }
  }, [identity, queryClient]);

  return null;
}

/**
 * App-level TanStack Query provider for the dashboard. The client is created once
 * per browser session (via useState) so its cache survives route navigation —
 * revisiting a page serves cached data instantly and revalidates in the
 * background. Defaults favor snappy navigation while keeping data reasonably
 * fresh; individual queries can override staleTime as needed.
 */
export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Treat data as fresh for 30s (no refetch on remount within window).
            staleTime: 30_000,
            // Keep unused cache entries for 5 minutes so back-navigation is instant.
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            // Retry transient failures once, but never a 4xx (auth/permission/
            // not-found won't succeed on retry). Applies to queries whose queryFn
            // throws HttpError (via fetchJson); others keep the single retry.
            retry: retryUnlessClientError,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <CacheResetOnIdentityChange />
      {children}
      {/* Dev-only cache inspector; tree-shaken out of production builds. */}
      {process.env.NODE_ENV !== 'production' && (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
      )}
    </QueryClientProvider>
  );
}
