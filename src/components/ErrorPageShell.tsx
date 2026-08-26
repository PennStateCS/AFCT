'use client';

import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type ErrorPageShellProps = {
  title: string;
  description: ReactNode;
  /** Buttons or links, laid out in a row that wraps on narrow screens. */
  actions?: ReactNode;
  /**
   * Next's error digest. Shown so someone can quote it when reporting the problem: it
   * identifies the entry in the server log without putting a stack trace, a file path or a
   * query on screen for whoever happened to hit the page.
   */
  digest?: string;
};

/**
 * The full-page frame the error screens share.
 *
 * One component so 404, a route error and a root error cannot drift into three different
 * treatments of the same moment. Deliberately free of app chrome: several of these render
 * when the surrounding layout is exactly what failed.
 */
export function ErrorPageShell({ title, description, actions, digest }: ErrorPageShellProps) {
  return (
    /**
     * The sign-in screen's surfaces, in the same order: a dark ground with a cobalt wash, and
     * one light card on it. It used to be a teal gradient left over from the old auth pages,
     * which is now the only place in the product that colour appeared.
     *
     * `auth-light` pins the card to the light palette, because next-themes puts `.dark` on
     * <html> for every route and this card is a fixed light surface. `auth-form-surface` on the
     * card itself makes its primary button the same cobalt as Sign In; the ground outside it
     * keeps the deeper navy, which is exactly how the two halves of the login relate.
     */
    <main className="auth-light bg-sidebar relative flex min-h-dvh w-full items-center justify-center overflow-hidden px-4 py-12">
      <div
        aria-hidden="true"
        className="to-primary/50 pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(96,165,250,0.14),transparent_62%)]"
      />
      <Card className="auth-form-surface bg-card relative w-full max-w-xl rounded-2xl border shadow-md">
        <CardHeader className="space-y-3 pb-4 text-center">
          <CardTitle
            aria-level={1}
            className="text-foreground text-3xl font-semibold tracking-tight"
          >
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center space-y-6 text-center">
          <div className="text-muted-foreground max-w-lg text-base leading-7">{description}</div>

          {actions ? (
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">{actions}</div>
          ) : null}

          {digest ? (
            <p className="text-muted-foreground text-xs">
              Reference code: <code className="font-mono">{digest}</code>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}

export default ErrorPageShell;
