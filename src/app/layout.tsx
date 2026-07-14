import './globals.css';
import type { Metadata } from 'next';
import { geistSans, geistMono } from '@/app/fonts';
import { RootProviders } from '@/components/providers/RootProviders';

// Now that the root layout is a Server Component, it can carry app-wide metadata.
// A plain default title (no template) so pages that set their own title keep it.
export const metadata: Metadata = {
  title: 'AFCT Dashboard',
  description: 'Automata-focused course tooling for building and grading assignments.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} flex antialiased`}>
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
