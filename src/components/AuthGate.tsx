'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

type Props = {
  children: React.ReactNode;
};

export default function AuthGate({ children }: Props) {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status === 'loading') return null;
  if (status === 'unauthenticated') return null;

  return <>{children}</>;
}
