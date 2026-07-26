'use client';

import { useRef, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import SelectField from '@/components/ui/SelectField';
import InputGroup from '@/components/ui/InputGroup';
import { useUpgrade, isUpgradeInProgress, type SelfUpdateState } from './useUpgrade';
import {
  upgradePhaseLabel,
  formatBackupTs,
  formatBackupTsLocal,
  formatBytes,
  isNewerThan,
} from './system-settings-shared';
import { UpgradeProgress } from './UpgradeProgress';
import { UpgradeLiveLog } from './UpgradeLiveLog';

// Colour the self-update banner by outcome: green on success, red on a real failure,
// amber while working / timed out / when the updater is simply behind.
function selfUpdateBannerClass(phase: SelfUpdateState['phase']): string {
  const base = 'max-w-xl space-y-2 rounded-md border p-3 text-sm';
  switch (phase) {
    case 'done':
      return `${base} border-green-500/40 bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-200`;
    case 'failed':
      return `${base} border-red-500/40 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200`;
    default:
      return `${base} border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200`;
  }
}

/** Updates tab: upgrade to a newer release, and restore/downgrade to a recorded backup. */
export function UpdatesTab({ disabled }: { disabled: boolean }) {
  // Only mounted while this tab is active (Radix unmounts inactive panels), so the
  // upgrade query runs exactly when the tab is open.
  const {
    info: upgradeInfo,
    loading: upgradeLoading,
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
  } = useUpgrade(true);

  const [selectedVersion, setSelectedVersion] = useState('');
  const [confirmUpgradeOpen, setConfirmUpgradeOpen] = useState(false);
  // Focus target for closing the upgrade/restore dialogs: their trigger buttons are
  // disabled once the action starts, so Radix's default focus return would land on
  // <body>. Send focus to the status panel instead.
  const upgradeStatusRef = useRef<HTMLDivElement | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<{ version: string; backup: string } | null>(
    null,
  );
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ version: string; backup: string } | null>(
    null,
  );
  // Which flow the admin last kicked off, so the progress checklist labels its steps
  // correctly (upgrade and downgrade share some early phases).
  const [lastAction, setLastAction] = useState<'upgrade' | 'downgrade' | null>(null);

  const upgradeInProgress = isUpgradeInProgress(upgradeInfo?.status);
  // Only offer versions newer than what's running: you can't "upgrade" to an older
  // release (that's the restore-points flow below). When the current tag isn't a
  // comparable version (e.g. `main` in dev), fall back to everything but the current.
  const upgradeableVersions = (upgradeInfo?.versions ?? []).filter((v) => {
    if (v.tag === upgradeInfo?.current) return false;
    const newer = isNewerThan(v.tag, upgradeInfo?.current ?? '');
    return newer === null ? true : newer;
  });
  const selectedVersionInfo = upgradeableVersions.find((v) => v.tag === selectedVersion);
  // Treated as available until the first load resolves, so the guidance doesn't flash.
  const updaterAvailable = upgradeInfo?.updaterAvailable !== false;
  const restorePoints = (upgradeInfo?.restorePoints ?? []).filter(
    (r) => r.version !== upgradeInfo?.current,
  );

  // Built inline (not memoized) so the per-row Restore button always reflects the
  // current busy flags. The list is tiny, so there's no cost to it.
  type RestorePoint = (typeof restorePoints)[number];
  const restoreColumns: ColumnDef<RestorePoint>[] = [
    {
      accessorKey: 'version',
      header: 'Version',
      cell: ({ row }) => (
        <span className="font-mono whitespace-nowrap">{row.original.version}</span>
      ),
      meta: { priority: 1 },
    },
    {
      accessorKey: 'backup',
      header: 'Backup taken',
      // Local time for the admin; raw server (UTC) time in the tooltip.
      cell: ({ row }) => (
        <span className="whitespace-nowrap" title={`${formatBackupTs(row.original.backup)} UTC`}>
          {formatBackupTsLocal(row.original.backup)}
        </span>
      ),
      meta: { priority: 1 },
    },
    {
      id: 'encryption',
      header: 'Encrypted',
      accessorFn: (r) => (r.encrypted === undefined ? '' : r.encrypted ? 'Yes' : 'No'),
      cell: ({ row }) =>
        row.original.encrypted === undefined ? (
          <span className="text-muted-foreground">—</span>
        ) : row.original.encrypted ? (
          <span className="whitespace-nowrap">Yes</span>
        ) : (
          <span className="whitespace-nowrap text-amber-600">No</span>
        ),
      meta: { priority: 2 },
    },
    {
      accessorKey: 'size',
      header: 'Size',
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {row.original.size == null ? '—' : formatBytes(row.original.size)}
        </span>
      ),
      meta: { priority: 2 },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      meta: { align: 'right', priority: 1 },
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          {/* Restore is green (the recovery action the admin wants), Delete is red.
              Restore is still guarded by type-to-confirm in its dialog, since a
              downgrade discards data. */}
          <Button
            type="button"
            size="sm"
            className="bg-green-600 text-white hover:bg-green-700 focus-visible:ring-green-600/30"
            aria-label={`Restore version ${row.original.version}`}
            disabled={disabled || downgradeBusy || upgradeInProgress}
            onClick={() => {
              setRestoreTarget({ version: row.original.version, backup: row.original.backup });
              setRestoreConfirmText('');
            }}
          >
            Restore
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            aria-label={`Delete the ${formatBackupTsLocal(row.original.backup)} backup for version ${row.original.version}`}
            disabled={disabled || deleteBusy || downgradeBusy || upgradeInProgress}
            onClick={() =>
              setDeleteTarget({ version: row.original.version, backup: row.original.backup })
            }
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="text-muted-foreground mb-4 max-w-2xl space-y-2 text-sm xl:max-w-4xl">
        <p>
          Upgrade AFCT to a newer published release, all from here, with no server login needed.
          When you start an upgrade, AFCT backs up the database, downloads the new version, and
          restarts. If the new version fails its health check it is rolled back to the current one
          automatically, so a bad release won&apos;t leave the site down.
        </p>
        <p>
          Some releases also improve the update system itself. Because the updater can&apos;t replace
          its own container while it&apos;s running, those show a second step afterward, an{' '}
          <span className="font-medium">Update the update service</span> button, so the next upgrade
          uses the newest logic. Both steps run here.
        </p>
        <p>
          Prefer the command line? You can still update from the server instead. In the directory
          that holds <code className="font-mono">docker-compose.yml</code>, run{' '}
          <code className="font-mono">sh install.sh update</code>. It does the same backup, swap, and
          health check as the in-app upgrade above.
        </p>
      </div>

      <div className="max-w-2xl space-y-5 xl:max-w-4xl">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Current version</h3>
          <Badge variant="secondary" className="w-fit font-mono">
            {upgradeLoading && !upgradeInfo ? 'Loading…' : (upgradeInfo?.current ?? 'unknown')}
          </Badge>
        </div>

        {/* The updater sidecar tracks the app version but is recreated on its own, so it
            can lag after an app upgrade. Offer to bring it up to date from here. Once a
            self-update starts, the outcome is tracked by watching the updater come back
            on the new version (the updater restarts itself, so it can't report its own
            success and a transient status would otherwise look like a failure). */}
        {(selfUpdate.phase !== 'idle' ||
          (!!upgradeInfo?.updaterVersion &&
            upgradeInfo.updaterVersion !== upgradeInfo.current &&
            !upgradeInProgress)) && (
          <div
            role={
              selfUpdate.phase === 'updating' || selfUpdate.phase === 'done' ? 'status' : 'note'
            }
            className={selfUpdateBannerClass(selfUpdate.phase)}
          >
            {selfUpdate.phase === 'updating' ? (
              <p>
                Updating the update service to{' '}
                <span className="font-mono">{selfUpdate.targetTag}</span>. It restarts as part of
                this, so it may briefly show as unavailable; this is expected and can take a minute
                or two.
              </p>
            ) : selfUpdate.phase === 'done' ? (
              <div className="flex items-center justify-between gap-3">
                <p>
                  The update service is now on{' '}
                  <span className="font-mono">{selfUpdate.targetTag}</span>.
                </p>
                <Button type="button" size="sm" variant="secondary" onClick={dismissSelfUpdate}>
                  Dismiss
                </Button>
              </div>
            ) : selfUpdate.phase === 'failed' ? (
              <div className="space-y-2">
                <p>
                  The update service could not be updated
                  {selfUpdate.message ? `: ${selfUpdate.message}` : '.'}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={disabled || selfUpdateBusy || !upgradeInfo}
                    onClick={() => upgradeInfo && startSelfUpdate(upgradeInfo.current)}
                  >
                    {selfUpdateBusy ? 'Updating…' : 'Try again'}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={dismissSelfUpdate}>
                    Dismiss
                  </Button>
                </div>
              </div>
            ) : selfUpdate.phase === 'timeout' ? (
              <div className="space-y-2">
                <p>
                  The update service is taking longer than expected to come back. Reload this page
                  in a moment; if it&apos;s still behind, run{' '}
                  <code className="font-mono">sh install.sh update</code> on the server.
                </p>
                <Button type="button" size="sm" variant="secondary" onClick={dismissSelfUpdate}>
                  Dismiss
                </Button>
              </div>
            ) : (
              <>
                <p>
                  The update service is on{' '}
                  <span className="font-mono">{upgradeInfo?.updaterVersion}</span>, behind the
                  app&apos;s <span className="font-mono">{upgradeInfo?.current}</span>. Update it so
                  future upgrades use the latest logic.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={disabled || selfUpdateBusy || !upgradeInfo}
                  onClick={() => upgradeInfo && startSelfUpdate(upgradeInfo.current)}
                >
                  {selfUpdateBusy ? 'Updating…' : 'Update the update service'}
                </Button>
              </>
            )}
          </div>
        )}

        {/* The self-update has its own banner above; hide the generic status card while
            it runs so the updater's transient self-update phases don't show here too. */}
        {upgradeInfo?.status?.phase && selfUpdate.phase === 'idle' && (
          <div className="space-y-2" ref={upgradeStatusRef} tabIndex={-1}>
            <h3 className="text-sm font-medium">Update status</h3>
            {/* role="status": phase changes arrive via background polling,
                so announce them to screen readers as they happen. */}
            <div
              role="status"
              className="bg-muted/10 w-full max-w-xl space-y-2 rounded-md border p-3 text-sm xl:max-w-3xl"
            >
              <Badge
                variant={
                  upgradeInfo.status.phase === 'healthy'
                    ? 'success'
                    : upgradeInfo.status.phase === 'failed'
                      ? 'destructive'
                      : upgradeInfo.status.phase === 'rolled_back'
                        ? 'warning'
                        : 'secondary'
                }
                className="w-fit"
              >
                {upgradePhaseLabel(upgradeInfo.status.phase)}
              </Badge>
              {upgradeInfo.status.message && (
                <p className="text-muted-foreground">{upgradeInfo.status.message}</p>
              )}
              {/* Only show the step checklist for a run that is actually happening (or one
                  this session started). A completed run leaves the status at `healthy`, and
                  on a later page load that would otherwise render every step as a green
                  check, making a not-yet-started upgrade look already done. */}
              {(upgradeInProgress || lastAction) && (
                <UpgradeProgress
                  phase={upgradeInfo.status.phase}
                  action={lastAction ?? undefined}
                />
              )}
              {/* Live streamed detail beneath the coarse checklist, so the long image
                  pull shows real movement instead of a frozen phase. */}
              <UpgradeLiveLog active={upgradeInProgress} />
              {upgradeInProgress && (
                <p className="text-muted-foreground text-xs">
                  This can take a few minutes; the site may briefly restart.
                </p>
              )}
              {/* Once a run this session settles, show where things landed: the app
                  version, the update service's version, and whether the updater is
                  running. Gated on lastAction so a leftover "healthy" from a previous
                  session doesn't render this on a fresh page load. */}
              {!upgradeInProgress && lastAction && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t pt-2 text-sm">
                  <dt className="text-muted-foreground">Dashboard</dt>
                  <dd className="font-mono">{upgradeInfo?.current ?? 'unknown'}</dd>
                  <dt className="text-muted-foreground">Update service</dt>
                  <dd>
                    <span className="font-mono">{upgradeInfo?.updaterVersion || 'unknown'}</span>
                    {upgradeInfo?.updaterVersion &&
                      (upgradeInfo.updaterVersion === upgradeInfo.current ? (
                        <span className="text-muted-foreground"> · up to date</span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-300">
                          {' '}
                          · behind the app
                        </span>
                      ))}
                  </dd>
                  <dt className="text-muted-foreground">Update service health</dt>
                  <dd>
                    {updaterAvailable ? (
                      <span className="text-green-700 dark:text-green-400">Running</span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-300">Not running</span>
                    )}
                  </dd>
                </dl>
              )}
            </div>
          </div>
        )}

        {!updaterAvailable ? (
          <div
            role="note"
            className="max-w-xl space-y-2 rounded-md border border-amber-500/40 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <p className="font-medium">The update service isn’t installed.</p>
            <p>
              In-app upgrades and downgrades need the privileged updater component, which isn’t
              running on this server. It holds the Docker socket, so it’s off by default.
            </p>
            <p>
              To enable it, run this on the server, in the directory that contains{' '}
              <code className="font-mono">docker-compose.yml</code>:
            </p>
            <pre className="bg-background/60 overflow-x-auto rounded border p-2 font-mono text-xs">
              sh install.sh enable-updater
            </pre>
            <p>
              Then reopen this tab. If your installer predates this command, run{' '}
              <code className="font-mono">sh install.sh self-update</code> first.
            </p>
          </div>
        ) : upgradeInfo?.manifestError ? (
          <p className="text-muted-foreground text-sm">
            The list of available versions could not be loaded. Check the server’s network access and
            reopen this tab to retry.
          </p>
        ) : upgradeableVersions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {upgradeLoading
              ? 'Loading available versions…'
              : 'AFCT is on the latest available version.'}
          </p>
        ) : (
          <div className="space-y-3">
            <SelectField
              label="Upgrade to"
              name="upgradeVersion"
              id="upgradeVersion"
              placeholder="Select a version"
              value={selectedVersion}
              onValueChange={setSelectedVersion}
              disabled={disabled || upgradeBusy || upgradeInProgress}
              options={upgradeableVersions.map((v) => ({
                value: v.tag,
                label: v.label && v.label !== v.tag ? `${v.label} (${v.tag})` : v.tag,
              }))}
              triggerClassName="border-black"
            />
            {selectedVersionInfo?.notes && (
              <p className="text-muted-foreground text-sm">{selectedVersionInfo.notes}</p>
            )}
            {selectedVersionInfo?.upgradeNote && (
              <div
                role="note"
                className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm whitespace-pre-line text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              >
                {selectedVersionInfo.upgradeNote}
              </div>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => setConfirmUpgradeOpen(true)}
              disabled={disabled || upgradeBusy || upgradeInProgress || !selectedVersion}
            >
              {upgradeBusy || upgradeInProgress ? 'Upgrading…' : 'Upgrade…'}
            </Button>
          </div>
        )}
      </div>

      <Dialog open={confirmUpgradeOpen} onOpenChange={setConfirmUpgradeOpen}>
        <DialogContent
          className="bg-card sm:max-w-lg"
          onCloseAutoFocus={(e) => {
            // Once the upgrade starts, the button that opened this dialog is
            // disabled, so the default focus return would drop to <body>.
            if ((upgradeBusy || upgradeInProgress) && upgradeStatusRef.current) {
              e.preventDefault();
              upgradeStatusRef.current.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Upgrade AFCT?</DialogTitle>
            <DialogDescription>
              AFCT will upgrade from <span className="font-mono">{upgradeInfo?.current}</span> to{' '}
              <span className="font-mono">{selectedVersion}</span>. It backs up the database first,
              downloads the new version, and restarts. This may take a few minutes, during which the
              site may be briefly unavailable. A failed upgrade is rolled back automatically.
            </DialogDescription>
            {selectedVersionInfo?.upgradeNote && (
              <p className="text-sm font-medium whitespace-pre-line text-amber-700 dark:text-amber-300">
                {selectedVersionInfo.upgradeNote}
              </p>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmUpgradeOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setLastAction('upgrade');
                startUpgrade(selectedVersion);
                setConfirmUpgradeOpen(false);
              }}
            >
              Upgrade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore / downgrade: destructive, so kept visually separate. */}
      {restorePoints.length > 0 && (
        <div className="mt-8 max-w-2xl space-y-3 border-t pt-6 xl:max-w-4xl">
          <h3 className="text-destructive text-sm font-semibold">Restore a previous version</h3>
          <p className="text-muted-foreground text-sm">
            Downgrading restores the database backup taken before that version was replaced. It{' '}
            <span className="text-destructive font-medium">
              permanently discards everything created since that backup
            </span>{' '}
            (submissions, grades, and accounts). Use this only for recovery.
          </p>
          <DataTable
            columns={restoreColumns}
            data={restorePoints}
            storageKey="system-restore-points"
            tableLabel="Restore points"
            // Short, action-focused list: skip the search/filter/columns/export toolbar.
            showToolbar={false}
            defaultSorting={[{ id: 'backup', desc: true }]}
            emptyTitle="No restore points"
            emptyDescription="A restore point is recorded automatically before each upgrade."
          />
        </div>
      )}

      <Dialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
      >
        <DialogContent
          className="bg-card sm:max-w-lg"
          onCloseAutoFocus={(e) => {
            // Same as the upgrade dialog: the row's Restore button is disabled
            // once the downgrade starts, so send focus to the status panel.
            if ((downgradeBusy || upgradeInProgress) && upgradeStatusRef.current) {
              e.preventDefault();
              upgradeStatusRef.current.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-destructive">
              Restore and downgrade to {restoreTarget?.version}?
            </DialogTitle>
            <DialogDescription>
              This restores the database backup from{' '}
              <span className="font-mono">
                {restoreTarget ? formatBackupTsLocal(restoreTarget.backup) : ''}
              </span>{' '}
              and runs <span className="font-mono">{restoreTarget?.version}</span>. Everything created
              since that backup (submissions, grades, accounts) is{' '}
              <span className="text-destructive font-medium">permanently lost</span>. A safety backup
              of the current state is taken first. Type{' '}
              <span className="font-mono">{restoreTarget?.version}</span> to confirm.
            </DialogDescription>
          </DialogHeader>
          <InputGroup
            label="Confirm version"
            name="restoreConfirm"
            // Carried on the field itself (aria-describedby) so screen-reader
            // users can re-query what to type without re-reading the dialog.
            description={`Type ${restoreTarget?.version ?? ''} to enable the restore button.`}
            value={restoreConfirmText}
            setValue={(v) => setRestoreConfirmText(v)}
            disabled={downgradeBusy}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRestoreTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={downgradeBusy || restoreConfirmText !== restoreTarget?.version}
              onClick={() => {
                if (restoreTarget) {
                  setLastAction('downgrade');
                  startDowngrade({
                    tag: restoreTarget.version,
                    restorePoint: restoreTarget.backup,
                  });
                }
                setRestoreTarget(null);
              }}
            >
              Restore and downgrade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete a restore point: removes the backup file(s) and drops it from the list.
          Less destructive than a downgrade (nothing in the running app changes), so a
          plain confirm is enough. */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="bg-card sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete this backup?</DialogTitle>
            <DialogDescription>
              This deletes the backup from{' '}
              <span className="font-mono">
                {deleteTarget ? formatBackupTsLocal(deleteTarget.backup) : ''}
              </span>{' '}
              and removes <span className="font-mono">{deleteTarget?.version}</span> from the restore
              list, so you can no longer downgrade to it. It does not affect the running application.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteBusy}
              onClick={() => {
                if (deleteTarget) startDeleteRestorePoint(deleteTarget.backup);
                setDeleteTarget(null);
              }}
            >
              Delete backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
