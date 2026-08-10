'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import InputGroup from '@/components/ui/InputGroup';
import { RequestPasswordResetSchema } from '@/schemas/password';

/**
 * Asking for a reset link.
 *
 * The confirmation is the same whatever happens, because the endpoint behind it is: the page
 * must never become a way to ask whether an address has an account here. So there is no "we
 * couldn't find that address" state to write, and there should never be one.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = RequestPasswordResetSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid email address.');
      return;
    }

    setError(null);
    setState('sending');
    try {
      const res = await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: parsed.data.email }),
      });
      if (res.ok) {
        setState('sent');
        return;
      }
      // The only real failure a caller can see: this site cannot send mail at all.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'Something went wrong. Try again.');
      setState('idle');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setState('idle');
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle aria-level={1}>Reset your password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === 'sent' ? (
            <>
              {/* Deliberately says nothing about whether the address exists. */}
              <p role="status" className="text-sm">
                If that address has an account, a reset link is on its way. The link works once
                and expires in an hour.
              </p>
              <p className="text-muted-foreground text-sm">
                Nothing arrived? Check the spam folder, or ask an administrator for help.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link href="/login">Back to sign in</Link>
              </Button>
            </>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <p className="text-muted-foreground text-sm">
                Enter the email address for your account and we will send you a link to choose a
                new password.
              </p>
              <InputGroup
                name="email"
                label="Email address"
                type="email"
                autoComplete="email"
                value={email}
                setValue={setEmail}
                error={error ?? undefined}
                disabled={state === 'sending'}
              />
              <Button type="submit" className="w-full" disabled={state === 'sending' || !email}>
                {state === 'sending' ? 'Sending…' : 'Send reset link'}
              </Button>
              <Button asChild variant="ghost" className="w-full">
                <Link href="/login">Back to sign in</Link>
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
