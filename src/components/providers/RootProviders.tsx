'use client';

import { Toaster } from 'sonner';
import { SessionProvider } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { ThemeProvider } from '@/components/providers/ThemeProvider';

/**
 * The app-wide client providers (theme, auth session, toasts). Kept in its own
 * client component so the root layout can stay a Server Component — otherwise a
 * `'use client'` at the root opts the whole tree out of server rendering and blocks
 * a root `metadata` export.
 */
export function RootProviders({ children }: { children: React.ReactNode }) {
  return (
    // `themes` has to list every value, including the two next-themes assumes: without it
    // "high-contrast" is not recognised and the class never lands. `system` stays implicit,
    // supplied by enableSystem.
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      themes={['light', 'dark', 'high-contrast']}
    >
      <SessionProvider>
        <AppToaster />
        {children}
      </SessionProvider>
    </ThemeProvider>
  );
}

/**
 * The toast portal. Split out so it can read the resolved theme (it must live inside the
 * ThemeProvider) and follow light/dark rather than being pinned. The visible toast colours
 * come from the token-driven `.custom-toast` styles in globals.css; this only keeps
 * sonner's own container in step with the app theme.
 */
function AppToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      position="top-center"
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      closeButton={false}
      expand={true}
      gap={8}
      visibleToasts={6}
      offset={20}
      icons={{
        success: (
          <span aria-hidden="true" className="toast-icon-symbol">
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M5 12.5L10 17L19 7.5"
                stroke="currentColor"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        ),
        error: (
          <span aria-hidden="true" className="toast-icon-symbol">
            ✕
          </span>
        ),
        warning: (
          <span aria-hidden="true" className="toast-icon-symbol">
            ⚠
          </span>
        ),
        info: (
          <span aria-hidden="true" className="toast-icon-symbol">
            i
          </span>
        ),
        loading: (
          <span aria-hidden="true" className="toast-icon-symbol">
            ↻
          </span>
        ),
      }}
      toastOptions={{
        style: {},
        className: 'custom-toast',
        duration: 4000,
        actionButtonStyle: {},
        cancelButtonStyle: {},
      }}
    />
  );
}
