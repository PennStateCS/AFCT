'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { showToast } from '@/lib/toast';

export default function SystemSettingsToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const saved = searchParams.get('saved');
    if (saved !== '1') return;

    showToast.success('System settings updated successfully.');

    const params = new URLSearchParams(searchParams);
    params.delete('saved');
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname);
  }, [searchParams, router, pathname]);

  return null;
}
