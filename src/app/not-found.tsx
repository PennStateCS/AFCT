'use client';

import Link from 'next/link';
import { ArrowRight, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorPageShell } from '@/components/ErrorPageShell';

export default function NotFoundPage() {
  return (
    <ErrorPageShell
      title="404 Error: Page not found"
      description="The page you tried to open is unavailable."
      actions={
        <Button asChild size="lg">
          <Link href="/dashboard">
            <Home className="mr-2 h-4 w-4" aria-hidden="true" />
            Go to dashboard
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      }
    />
  );
}
