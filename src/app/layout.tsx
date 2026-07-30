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
      <head>
        {/* KaTeX, self-hosted from public/katex (see scripts/vendor-katex.mjs). Linked rather
            than imported, which is exactly what no-css-tags warns about, and is the point: the
            stylesheet's 60 relative font urls would otherwise become 60 bundler modules in the
            chunk graph of every route that renders maths, and dev compiles stalled for minutes.
            It is a static third-party stylesheet that never changes between builds, so Next's
            CSS pipeline buys nothing here. Same origin, never a CDN. */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/katex/katex.min.css" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} flex antialiased`}>
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
