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
    <main className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-[#5F9EA0] via-[#6FAFB2] to-[#2F4A8A] px-4 py-12">
      <Card className="border-border bg-card w-full max-w-xl border-2 border-solid shadow-[0_20px_60px_-20px_rgba(25,59,127,0.25)]">
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
