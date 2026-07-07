'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
