import { useEffect, useState } from 'react';
import { DEFAULT_MAX_UPLOAD_SIZE_MB } from '@/lib/system-settings';

type UseMaxUploadSizeResult = {
  maxMb: number;
  loading: boolean;
  error: string | null;
};

export function useMaxUploadSize(): UseMaxUploadSizeResult {
  const [maxMb, setMaxMb] = useState(DEFAULT_MAX_UPLOAD_SIZE_MB);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    async function fetchMaxSize() {
      try {
        const res = await fetch('/api/system-settings/public', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to fetch settings');

        const data = (await res.json()) as {
          sessionTimeoutMinutes?: number;
          maxUploadSizeMb?: number;
        };
        if (!ignore) {
          setMaxMb(data.maxUploadSizeMb ?? DEFAULT_MAX_UPLOAD_SIZE_MB);
          setError(null);
        }
      } catch (err) {
        if (!ignore) {
          console.error('Failed to fetch max upload size:', err);
          setError('Could not load upload limit');
          setMaxMb(DEFAULT_MAX_UPLOAD_SIZE_MB);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    fetchMaxSize();

    return () => {
      ignore = true;
    };
  }, []);

  return { maxMb, loading, error };
}
