import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  // Optional free-text note for this release, shown when the version is selected.
  upgradeNote?: string;
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
  // Backup file details, joined server-side from the backup directory. Undefined when
  // the backup file is missing or unreadable.
  size?: number | null;
  encrypted?: boolean;
};

export type UpgradeInfo = {
  current: string;
  status: UpdateStatus | null;
  versions: ReleaseVersion[];
  manifestError: boolean;
  // False when the privileged updater sidecar isn't installed/running, so in-app
  // upgrades and downgrades can't be performed.
  updaterAvailable: boolean;
  // The updater sidecar's own running version. It tracks the app tag but is recreated
  // separately, so when this lags `current` the UI can offer to update it. Empty if an
  // older updater that doesn't stamp its version is running.
  updaterVersion?: string;
  // What the updater reports about its own configuration. A container keeps the paths it
  // started with, so one left running across a compose change can be the right VERSION and
  // still not find the files it must rewrite. Null when the updater is too old to report,
  // which is not a problem: treat it as unknown, not as broken.
  updaterReadiness?: {
    envFile: string;
    composeFile: string;
    envFileOk: boolean;
    composeFileOk: boolean;
  } | null;
  restorePoints: RestorePoint[];
};

/**
 * The updater is running, but cannot reach a file it has to rewrite to do an upgrade.
 *
 * Deliberately false when there is no report at all, so an older updater is never accused
 * of a fault it hasn't reported.
 */
export function isUpdaterMisconfigured(info: UpgradeInfo | null | undefined): boolean {
  const r = info?.updaterReadiness;
  if (!r) return false;
  return !r.envFileOk || !r.composeFileOk;
}

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
// After requesting an upgrade the sidecar takes a moment to notice the request and
// write its first status. Keep polling through that window even if the last status
// still reads terminal (e.g. a previous run's "healthy"), so a stale first poll can't
// stop us before the new run reports in.
const REQUEST_GRACE_MS = 45_000;

// The updater replaces its OWN container during a self-update, so it can't report its
// own success: the app confirms it by watching for the updater to come back on the new
// version. If it hasn't within this window, the UI stops waiting and nudges the admin
// (a soft "taking longer than expected", never a hard failure).
const SELF_UPDATE_TIMEOUT_MS = 150_000;

// The self-update has its own lifecycle, separate from the upgrade status.json channel,
// because the updater restarting itself would otherwise read as an upgrade failure.
export type SelfUpdateState =
  | { phase: 'idle' }
  | { phase: 'updating'; targetTag: string; requestId: string; startedAt: number }
  | { phase: 'done'; targetTag: string }
  | { phase: 'failed'; targetTag: string; message?: string }
  | { phase: 'timeout'; targetTag: string };

export function useUpgrade(enabled: boolean) {
  const queryClient = useQueryClient();
  // Wall-clock of the last upgrade/downgrade request, so the poller keeps going during
  // the grace window above. A ref (not state) because only the poll callback reads it.
  const requestedAtRef = useRef(0);
  // Self-update lifecycle, driven by watching updaterVersion rather than status.json.
  const [selfUpdate, setSelfUpdate] = useState<SelfUpdateState>({ phase: 'idle' });
  // Mirror of whether a self-update is in flight, read by the poll callback (which
  // can't depend on `selfUpdate` state without being re-created each render).
  const selfUpdatingRef = useRef(false);

  // Flip the cached status to an in-flight phase right after a request so the status
  // panel and live log appear immediately, with no manual refresh, and the poll starts.
  const markInProgress = (status: UpdateStatus) => {
    const prev = queryClient.getQueryData<UpgradeInfo>(UPGRADE_QUERY_KEY);
    if (prev) queryClient.setQueryData<UpgradeInfo>(UPGRADE_QUERY_KEY, { ...prev, status });
    requestedAtRef.current = Date.now();
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: UPGRADE_QUERY_KEY,
    queryFn: () => fetchJson<UpgradeInfo>(apiPaths.admin.upgrade(), { cache: 'no-store' }),
    enabled,
    staleTime: 10_000,
    // Poll every 3s while an upgrade is mid-flight, or briefly after a request while the
    // sidecar spins up; stop once it settles.
    refetchInterval: (query) =>
      isUpgradeInProgress(query.state.data?.status) ||
      selfUpdatingRef.current ||
      Date.now() - requestedAtRef.current < REQUEST_GRACE_MS
        ? 3000
        : false,
    // An upgrade takes minutes, so nobody watches it happen: they start it and switch
    // away. Without this the interval timer stops the moment the tab loses focus and the
    // panel is frozen at whatever it last saw, which is why the status and the live log
    // only moved on a manual page refresh. The interval itself is still gated on an
    // upgrade being in flight, so this does not leave a poll running in the background
    // the rest of the time.
    refetchIntervalInBackground: true,
    // Browsers throttle timers in a background tab hard (Chrome down to about once a
    // minute), so the interval above is necessary but not sufficient: coming back to the
    // tab has to snap the panel current rather than waiting out a throttled tick. The app
    // turns focus refetching off globally, so this query opts back in, and only while
    // something is actually running.
    //
    // 'always' rather than true, because true still defers to `staleTime` below: a status
    // nine seconds old counts as fresh, and nine seconds of a running upgrade is exactly
    // the stale panel this is here to fix.
    refetchOnWindowFocus: () =>
      isUpgradeInProgress(queryClient.getQueryData<UpgradeInfo>(UPGRADE_QUERY_KEY)?.status) ||
      selfUpdatingRef.current ||
      Date.now() - requestedAtRef.current < REQUEST_GRACE_MS
        ? 'always'
        : false,
  });

  const { mutate: startUpgrade, isPending: upgradeBusy } = useMutation({
    mutationFn: (tag: string) =>
      fetchJson(apiPaths.admin.upgrade(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tag }),
      }),
    onSuccess: (_data, tag) => {
      const current = queryClient.getQueryData<UpgradeInfo>(UPGRADE_QUERY_KEY)?.current;
      markInProgress({
        phase: 'backing_up',
        message: 'Starting the upgrade…',
        fromTag: current,
        toTag: tag,
      });
      showToast.success('Upgrade requested. AFCT will update and restart shortly.');
    },
    onError: (err) => {
      showToast.error(err instanceof Error ? err.message : 'Failed to start the upgrade');
    },
  });

  const { mutate: startDowngrade, isPending: downgradeBusy } = useMutation({
    // `force` proceeds without a confirmed pre-downgrade safety backup; only set when the
    // admin retries after the updater refused for that reason.
    mutationFn: (v: { tag: string; restorePoint: string; force?: boolean }) =>
      fetchJson(apiPaths.admin.upgrade(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'downgrade',
          tag: v.tag,
          restorePoint: v.restorePoint,
          ...(v.force ? { force: true } : {}),
        }),
      }),
    onSuccess: (_data, v) => {
      const current = queryClient.getQueryData<UpgradeInfo>(UPGRADE_QUERY_KEY)?.current;
      markInProgress({
        phase: 'backing_up',
        message: v.force
          ? 'Starting the restore (without a safety backup)…'
          : 'Starting the restore…',
        fromTag: current,
        toTag: v.tag,
      });
      showToast.success('Downgrade requested. AFCT will restore and restart shortly.');
    },
    onError: (err) => {
      showToast.error(err instanceof Error ? err.message : 'Failed to start the downgrade');
    },
  });

  const { mutate: startSelfUpdate, isPending: selfUpdateBusy } = useMutation({
    // Bring the updater sidecar up to the running app version.
    mutationFn: (tag: string) =>
      fetchJson<{ ok: boolean; requestId: string }>(apiPaths.admin.upgrade(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'self-update', tag }),
      }),
    onSuccess: (data, tag) => {
      // Enter the self-update lifecycle. From here the outcome is decided by watching
      // the updater come back on the new version (see the effects below), NOT by the
      // status.json phase, whose transient values during the container swap would
      // otherwise read as a failure.
      selfUpdatingRef.current = true;
      setSelfUpdate({
        phase: 'updating',
        targetTag: tag,
        requestId: data.requestId,
        startedAt: Date.now(),
      });
      showToast.success('Update service is updating and will restart shortly.');
    },
    onError: (err) => {
      showToast.error(err instanceof Error ? err.message : 'Failed to update the update service');
    },
  });

  // Resolve the self-update by watching the updater's reported version. Success is the
  // updater coming back on the target version; a genuine failure is the updater
  // reporting `failed` for this request while still running the old version (a
  // pre-swap failure, e.g. the image couldn't be pulled).
  useEffect(() => {
    if (selfUpdate.phase !== 'updating') return;
    const { targetTag, requestId } = selfUpdate;
    const updaterVersion = data?.updaterVersion;
    const updaterUp = data?.updaterAvailable !== false;
    const status = data?.status;

    if (updaterVersion && updaterVersion === targetTag && updaterUp) {
      selfUpdatingRef.current = false;
      setSelfUpdate({ phase: 'done', targetTag });
      return;
    }
    if (
      status?.phase === 'failed' &&
      status.requestId === requestId &&
      updaterUp &&
      updaterVersion !== targetTag
    ) {
      selfUpdatingRef.current = false;
      setSelfUpdate({ phase: 'failed', targetTag, message: status.message });
    }
  }, [data, selfUpdate]);

  // Independent timeout: if the updater never reports back, stop waiting and nudge the
  // admin rather than spinning forever. Kept off the status poll so it fires even if
  // the polled data stops changing.
  useEffect(() => {
    if (selfUpdate.phase !== 'updating') return;
    const remaining = SELF_UPDATE_TIMEOUT_MS - (Date.now() - selfUpdate.startedAt);
    const timer = setTimeout(
      () => {
        selfUpdatingRef.current = false;
        setSelfUpdate((s) =>
          s.phase === 'updating' ? { phase: 'timeout', targetTag: s.targetTag } : s,
        );
      },
      Math.max(0, remaining),
    );
    return () => clearTimeout(timer);
  }, [selfUpdate]);

  // Clear a settled self-update back to idle (the banner returns to its normal state).
  const dismissSelfUpdate = () => setSelfUpdate({ phase: 'idle' });

  const { mutate: startDeleteRestorePoint, isPending: deleteBusy } = useMutation({
    // Remove a recorded restore point and its backup file(s). The updater does the
    // work asynchronously, so optimistically drop the row for instant feedback and
    // reconcile with a refetch once the sidecar has had time to process it.
    mutationFn: (backup: string) =>
      fetchJson(apiPaths.admin.upgrade(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete-restore-point', restorePoint: backup }),
      }),
    onMutate: (backup: string) => {
      const prev = queryClient.getQueryData<UpgradeInfo>(UPGRADE_QUERY_KEY);
      if (prev) {
        queryClient.setQueryData<UpgradeInfo>(UPGRADE_QUERY_KEY, {
          ...prev,
          restorePoints: prev.restorePoints.filter((r) => r.backup !== backup),
        });
      }
      return { prev };
    },
    onError: (err, _backup, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(UPGRADE_QUERY_KEY, ctx.prev);
      showToast.error(err instanceof Error ? err.message : 'Failed to delete the restore point');
    },
    onSuccess: () => {
      showToast.deleted('Restore point');
    },
    onSettled: () => {
      // The sidecar polls for the request, so give it a moment before reconciling.
      setTimeout(() => void refetch(), 6000);
    },
  });

  return {
    info: data,
    loading: isLoading,
    upgradeBusy,
    downgradeBusy,
    selfUpdateBusy,
    deleteBusy,
    startUpgrade,
    startDowngrade,
    startSelfUpdate,
    startDeleteRestorePoint,
    selfUpdate,
    dismissSelfUpdate,
    refetch,
  };
}
