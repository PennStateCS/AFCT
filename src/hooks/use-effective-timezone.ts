'use client';

import { useEffect, useState } from 'react';

export function useEffectiveTimezone() {
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [timezone, setTimezone] = useState(browserTz);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadTimezone = async () => {
      try {
        const [profileRes, systemRes] = await Promise.all([
          fetch('/api/profile', { cache: 'no-store' }),
          fetch('/api/system-settings/public', { cache: 'no-store' }),
        ]);

        let userTz = '';
        if (profileRes.ok) {
          const profile = await profileRes.json();
          userTz = String(profile?.timezone ?? '');
        }

        let serverTz = 'UTC';
        if (systemRes.ok) {
          const system = await systemRes.json();
          serverTz = String(system?.timezone ?? 'UTC');
        }

        const nextTz = userTz || serverTz || browserTz || 'UTC';
        if (!cancelled) setTimezone(nextTz);
      } catch {
        if (!cancelled) setTimezone(browserTz || 'UTC');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadTimezone();
    return () => {
      cancelled = true;
    };
  }, []);

  return { timezone, loading };
}
