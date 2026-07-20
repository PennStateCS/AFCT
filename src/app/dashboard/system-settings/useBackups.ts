import { useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query-fetch';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';

// One backup = a database dump plus a matching upload-files archive.
export type BackupInfo = {
  timestamp: string;
  dumpFile: string | null;
  dumpSize: number | null;
  filesFile: string | null;
  filesSize: number | null;
};

const BACKUPS_QUERY_KEY = ['admin', 'settings', 'backups'] as const;

/**
 * The backups subsystem of the system-settings page: the cached list and the
 * "Back up now" action. The backup container runs a requested backup on its next
 * tick, so after triggering we poll the list until the new backup appears (or give
 * up after ~1 minute). Managed independently of the settings form's Save.
 */
export function useBackups() {
  const {
    data: backups = [],
    isLoading: backupsLoading,
    refetch: refetchBackups,
  } = useQuery({
    queryKey: BACKUPS_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch(apiPaths.admin.backups(), { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load backups');
      const data = (await res.json()) as { backups?: BackupInfo[] };
      return Array.isArray(data.backups) ? data.backups : [];
    },
    staleTime: 30_000,
  });

  // Force-refresh helper used after "Back up now"; returns the new count so the
  // caller can poll until the freshly-requested backup appears.
  const reloadBackups = useCallback(async (): Promise<number> => {
    const { data } = await refetchBackups();
    return Array.isArray(data) ? data.length : 0;
  }, [refetchBackups]);

  const { mutate: triggerBackup, isPending: backupNowBusy } = useMutation({
    mutationFn: (_beforeCount: number) => fetchJson(apiPaths.admin.backups(), { method: 'POST' }),
    onSuccess: (_data, beforeCount) => {
      showToast.success('Backup requested. It should appear within a minute.');
      // The backup container runs the request on its next tick; poll until the
      // new backup shows up (or we give up after ~1 minute).
      let tries = 0;
      const poll = async () => {
        tries += 1;
        const count = await reloadBackups();
        if (count <= beforeCount && tries < 10) setTimeout(() => void poll(), 6000);
      };
      setTimeout(() => void poll(), 6000);
    },
    onError: (err) => {
      showToast.error(err instanceof Error ? err.message : 'Failed to start backup');
    },
  });

  const handleBackupNow = async () => {
    // Capture the current backup count before triggering so the poll can detect
    // the new backup appearing.
    const before = await reloadBackups();
    triggerBackup(before);
  };

  return { backups, backupsLoading, backupNowBusy, handleBackupNow };
}
