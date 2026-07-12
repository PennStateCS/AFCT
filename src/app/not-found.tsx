'use client';

import Link from 'next/link';
import { ArrowRight, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-[#5F9EA0] via-[#6FAFB2] to-[#2F4A8A] px-4 py-12">
      <Card className="w-full max-w-xl border-2 border-solid border-gray-700 bg-card shadow-[0_20px_60px_-20px_rgba(25,59,127,0.25)]">
        <CardHeader className="space-y-3 pb-4 text-center">
          <CardTitle aria-level={1} className="text-3xl font-semibold tracking-tight text-foreground">
            404 Error: Page not found
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center space-y-6 text-center">
          <p className="max-w-lg text-base leading-7 text-muted-foreground">
            The page you tried to open is unavailable.
          </p>

          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/dashboard">
              <Home className="mr-2 h-4 w-4" />
              Go to dashboard
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}