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
          <SessionProvider>
            <SessionWatcher />
            <Toaster
              position="top-center"
              theme="system"
              richColors
              toastOptions={{
                style: {
                  fontSize: '0.875rem',
                  padding: '1.25rem 1.5rem',
                  borderRadius: '6px',
                  boxShadow: '0 8px 40px 0 rgba(0,0,0,0.15)',
                },
              }}
            />
            {children}
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
