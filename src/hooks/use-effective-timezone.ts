'use client';

import { useEffect, useState } from 'react';

const CACHE_KEY = 'afct:effective-timezone';
const CACHE_TTL_MS = 5 * 60 * 1000;

export function useEffectiveTimezone() {
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [timezone, setTimezone] = useState(browserTz);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadTimezone = async () => {
      try {
        if (typeof window !== 'undefined') {
          const cached = window.sessionStorage.getItem(CACHE_KEY);
          if (cached) {
            const parsed = JSON.parse(cached) as { tz: string; ts: number };
            if (parsed?.tz && Date.now() - parsed.ts < CACHE_TTL_MS) {
              if (!cancelled) setTimezone(parsed.tz);
              if (!cancelled) setLoading(false);
              return;
            }
          }
        }

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
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ tz: nextTz, ts: Date.now() }));
        }
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
  }, [browserTz]);

  return { timezone, loading };
}
