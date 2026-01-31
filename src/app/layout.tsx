'use client';

import './globals.css';
import { geistSans, geistMono } from '@/app/fonts';
import { Toaster } from 'sonner';
import { SessionProvider } from 'next-auth/react';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import SessionWatcher from '@/components/SessionWatcher';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} flex antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <SessionProvider refetchOnWindowFocus={false} refetchInterval={0}>
            <SessionWatcher />
            <Toaster
              position="top-center"
              theme="light"
              closeButton
              expand={true}
              offset={20}
              icons={{
                success: '✓',
                error: '✕',
                warning: '⚠',
                info: 'i',
                loading: '○',
              }}
              toastOptions={{
                style: {},
                className: 'custom-toast',
                duration: 4000,
                actionButtonStyle: {},
                cancelButtonStyle: {},
              }}
            />
            {children}
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
