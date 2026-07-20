import { useQuery, useMutation } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query-fetch';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';

export type ReleaseVersion = {
  tag: string;
  label?: string;
  notes?: string;
  releasedAt?: string;
  // See src/lib/updates.ts: this release also needs a host-side `install.sh update`.
  requiresHostUpdate?: boolean;
};

export type UpdateStatus = {
  requestId?: string;
  phase?: string;
  message?: string;
  fromTag?: string;
  toTag?: string;
  updatedAt?: string;
};

export type RestorePoint = {
  version: string;
  backup: string;
  createdAt?: string;
};

export type UpgradeInfo = {
  current: string;
  status: UpdateStatus | null;
  versions: ReleaseVersion[];
  manifestError: boolean;
  // False when the privileged updater sidecar isn't installed/running, so in-app
  // upgrades and downgrades can't be performed.
  updaterAvailable: boolean;
  restorePoints: RestorePoint[];
};

const UPGRADE_QUERY_KEY = ['admin', 'settings', 'upgrade'] as const;

// Phases that mean an upgrade is still running, so the status should keep polling.
const TERMINAL_PHASES = new Set(['healthy', 'rolled_back', 'failed']);
export function isUpgradeInProgress(status: UpdateStatus | null | undefined): boolean {
  return !!status?.phase && !TERMINAL_PHASES.has(status.phase);
}

/**
 * The upgrade panel of the system-settings page: the deployed version, the curated
 * releases, and the "upgrade to X" action. The swap happens asynchronously in the
 * updater sidecar, so while one is in flight we poll the status until it reaches a
 * terminal phase. Gated on `enabled` so it only runs while the Updates tab is open.
 */
export function useUpgrade(enabled: boolean) {
  const {
    data,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: UPGRADE_QUERY_KEY,
    queryFn: () => fetchJson<UpgradeInfo>(apiPaths.admin.upgrade(), { cache: 'no-store' }),
    enabled,
    staleTime: 10_000,
    // Poll every 3s while an upgrade is mid-flight; stop once it settles.
    refetchInterval: (query) => (isUpgradeInProgress(query.state.data?.status) ? 3000 : false),
  });

  const { mutate: startUpgrade, isPending: upgradeBusy } = useMutation({
    mutationFn: (tag: string) =>
      fetchJson(apiPaths.admin.upgrade(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tag }),
      }),
    onSuccess: () => {
      showToast.success('Upgrade requested. AFCT will update and restart shortly.');
      void refetch();
    },
    onError: (err) => {
      showToast.error(err instanceof Error ? err.message : 'Failed to start the upgrade');
    },
  });

  const { mutate: startDowngrade, isPending: downgradeBusy } = useMutation({
    mutationFn: (v: { tag: string; restorePoint: string }) =>
      fetchJson(apiPaths.admin.upgrade(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'downgrade', tag: v.tag, restorePoint: v.restorePoint }),
      }),
    onSuccess: () => {
      showToast.success('Downgrade requested. AFCT will restore and restart shortly.');
      void refetch();
    },
    onError: (err) => {
      showToast.error(err instanceof Error ? err.message : 'Failed to start the downgrade');
    },
  });

  return {
    info: data,
    loading: isLoading,
    upgradeBusy,
    downgradeBusy,
    startUpgrade,
    startDowngrade,
    refetch,
  };
}
