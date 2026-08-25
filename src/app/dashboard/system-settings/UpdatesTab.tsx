'use client';

import { useRef, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import SelectField from '@/components/ui/SelectField';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import {
  useUpgrade,
  isUpgradeInProgress,
  isUpdaterMisconfigured,
  type SelfUpdateState,
} from './useUpgrade';
import {
  upgradePhaseLabel,
  formatBackupTs,
  formatBackupTsLocal,
  formatBytes,
  isNewerThan,
  downgradeRefusedForSafetyBackup,
} from './system-settings-shared';
import { UpgradeProgress } from './UpgradeProgress';
import { UpgradeLiveLog } from './UpgradeLiveLog';
import { SETTINGS_READABLE, SETTINGS_WIDE, SettingsFormLayout } from './settings-layout';

// Colour the self-update banner by outcome via the semantic status tokens: success on a
// completed update, danger on a real failure, warning while working / timed out / when the
// updater is simply behind. The tokens carry their own dark-mode values (see globals.css).
function selfUpdateBannerClass(phase: SelfUpdateState['phase']): string {
  const base = 'max-w-xl space-y-2 rounded-md border p-3 text-sm';
  switch (phase) {
    case 'done':
      return `${base} border-status-success-border bg-status-success-bg text-status-success`;
    case 'failed':
      return `${base} border-status-danger-border bg-status-danger-bg text-status-danger`;
    default:
      return `${base} border-status-warning-border bg-status-warning-bg text-status-warning`;
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
  const [deleteTarget, setDeleteTarget] = useState<{ version: string; backup: string } | null>(
    null,
  );
  // Which flow the admin last kicked off, so the progress checklist labels its steps
  // correctly (upgrade and downgrade share some early phases).
  const [lastAction, setLastAction] = useState<'upgrade' | 'downgrade' | null>(null);
  // The last downgrade target this session, kept so a forced retry can re-issue the same
  // (version, restorePoint) if the updater refused for lack of a confirmed safety backup.
  const [lastDowngrade, setLastDowngrade] = useState<{ version: string; backup: string } | null>(
    null,
  );
  const [confirmForceOpen, setConfirmForceOpen] = useState(false);

  const upgradeInProgress = isUpgradeInProgress(upgradeInfo?.status);
  // Running, current, and still unable to do the job: the case that produced an upgrade
  // failure with nothing on this page hinting at the cause.
  const updaterMisconfigured = isUpdaterMisconfigured(upgradeInfo);
  // The updater refuses a downgrade when it can't confirm a pre-downgrade safety backup,
  // BEFORE it stops the app or restores anything, so it's a safe state to offer a forced
  // retry from. Only surface it for a downgrade this session refused for exactly that
  // reason, and only while nothing new is running.
  const downgradeNeedsForce =
    lastAction === 'downgrade' &&
    !!lastDowngrade &&
    upgradeInfo?.status?.phase === 'failed' &&
    !upgradeInProgress &&
    !downgradeBusy &&
    downgradeRefusedForSafetyBackup(upgradeInfo?.status?.message);
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
          <span className="text-status-warning whitespace-nowrap">No</span>
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
          {/* Not `success`: green says the action is a good outcome, and the comment above
              says this one discards data and is guarded by type-to-confirm. Neutral beside
              the red Delete, which is the actual destructive one. */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`Restore version ${row.original.version}`}
            disabled={disabled || downgradeBusy || upgradeInProgress}
            onClick={() =>
              setRestoreTarget({ version: row.original.version, backup: row.original.backup })
            }
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
      {/* The same column every settings form uses, so clicking between tabs does not move
          the right edge. The panels inside keep their own narrower measures; the live log
          is the one that wants the room this gives it. */}
      <SettingsFormLayout className="[&>div]:space-y-5">
        <div className="text-muted-foreground mb-4 max-w-2xl space-y-2 text-sm xl:max-w-4xl">
          <p>
            Upgrade AFCT to a newer published release, all from here, with no server login needed.
            When you start an upgrade, AFCT backs up the database, downloads the new version, and
            restarts. If the new version fails its health check it is rolled back to the current one
            automatically, so a bad release won&apos;t leave the site down.
          </p>
          <p>
            Some releases also improve the update system itself. Because the updater can&apos;t
            replace its own container while it&apos;s running, those show a second step afterward,
            an <span className="font-medium">Update the update service</span> button, so the next
            upgrade uses the newest logic. Both steps run here.
          </p>
          <p>
            Prefer the command line? You can still update from the server instead. In the directory
            that holds <code className="font-mono">docker-compose.yml</code>, run{' '}
            <code className="font-mono">sh install.sh update</code>. It does the same backup, swap,
            and health check as the in-app upgrade above.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="text-base font-semibold">Current version</h2>
          {/* Same card as Update status below, so the two read as one pair rather than a
              bare badge above a panel. The health badge repeats the phase deliberately:
              this line answers "what am I running and is it well", which is the question
              asked on arriving at the tab, while the panel below carries the detail and
              the live progress of a run. */}
          <div className="bg-muted flex w-full max-w-xl flex-wrap items-center gap-2 rounded-md border p-3 text-sm xl:max-w-3xl">
            <Badge variant="secondary" className="w-fit font-mono">
              {upgradeLoading && !upgradeInfo ? 'Loading…' : (upgradeInfo?.current ?? 'unknown')}
            </Badge>
            {upgradeInfo?.status?.phase && (
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
            )}
          </div>
        </div>

        {/* Separate from the version check below, and deliberately above it: an updater
            can be the CURRENT version and still be unable to upgrade, because a container
            keeps the file paths it was created with. Updating it recreates the container,
            which is the fix, so this offers the same button for a different reason. */}
        {updaterMisconfigured && selfUpdate.phase === 'idle' && !upgradeInProgress && (
          <div
            role="note"
            className="border-status-warning-border bg-status-warning-bg text-status-warning max-w-xl space-y-2 rounded-md border p-4 text-sm"
          >
            <p className="font-medium">
              The update service needs restarting before it can upgrade.
            </p>
            <p>
              It is running, but it can&apos;t find the{' '}
              {!upgradeInfo?.updaterReadiness?.envFileOk ? 'settings file' : 'stack file'} it has to
              change:{' '}
              <span className="font-mono break-all">
                {!upgradeInfo?.updaterReadiness?.envFileOk
                  ? upgradeInfo?.updaterReadiness?.envFile
                  : upgradeInfo?.updaterReadiness?.composeFile}
              </span>
              . This happens when it has been running since before the file moved. Upgrades will
              fail until it is restarted on the current configuration.
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={disabled || selfUpdateBusy || !upgradeInfo}
              onClick={() => upgradeInfo && startSelfUpdate(upgradeInfo.current)}
            >
              {selfUpdateBusy ? 'Restarting…' : 'Update the update service'}
            </Button>
          </div>
        )}

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
            <h2 className="text-base font-semibold">Update status</h2>
            {/* role="status": phase changes arrive via background polling,
                so announce them to screen readers as they happen. */}
            <div
              role="status"
              className="bg-muted w-full max-w-xl space-y-2 rounded-md border p-3 text-sm xl:max-w-3xl"
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
              {/* The downgrade was refused because no safety backup could be confirmed.
                  Nothing was changed, so offer to proceed anyway (an explicit choice to
                  discard the current state), behind its own type-to-confirm dialog. */}
              {downgradeNeedsForce && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={disabled || downgradeBusy}
                    onClick={() => setConfirmForceOpen(true)}
                  >
                    Downgrade without a safety backup
                  </Button>
                  <span className="text-muted-foreground text-xs">
                    The current state will not be recoverable.
                  </span>
                </div>
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
                    {/* Matching versions is not the same as being able to upgrade, and
                        saying "up to date" over a misconfigured updater is what sent the
                        last investigation looking in the wrong place. */}
                    {updaterMisconfigured ? (
                      <span className="text-status-warning"> · needs restarting</span>
                    ) : (
                      upgradeInfo?.updaterVersion &&
                      (upgradeInfo.updaterVersion === upgradeInfo.current ? (
                        <span className="text-muted-foreground"> · up to date</span>
                      ) : (
                        <span className="text-status-warning"> · behind the app</span>
                      ))
                    )}
                  </dd>
                  <dt className="text-muted-foreground">Update service health</dt>
                  <dd>
                    {updaterAvailable ? (
                      <span className="text-status-success">Running</span>
                    ) : (
                      <span className="text-status-warning">Not running</span>
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
            className="border-status-warning-border bg-status-warning-bg text-status-warning max-w-xl space-y-2 rounded-md border p-4 text-sm"
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
            The list of available versions could not be loaded. Check the server’s network access
            and reopen this tab to retry.
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
            />
            {selectedVersionInfo?.notes && (
              <p className="text-muted-foreground text-sm">{selectedVersionInfo.notes}</p>
            )}
            {selectedVersionInfo?.upgradeNote && (
              <div
                role="note"
                className="border-status-warning-border bg-status-warning-bg text-status-warning rounded-md border p-3 text-sm whitespace-pre-line"
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
      </SettingsFormLayout>

      <ConfirmDialog
        open={confirmUpgradeOpen}
        title="Upgrade AFCT?"
        description={
          <>
            AFCT will upgrade from <span className="font-mono">{upgradeInfo?.current}</span> to{' '}
            <span className="font-mono">{selectedVersion}</span>. It backs up the database first,
            downloads the new version, and restarts. This may take a few minutes, during which the
            site may be briefly unavailable. A failed upgrade is rolled back automatically.
            {selectedVersionInfo?.upgradeNote && (
              <span className="text-status-warning mt-2 block font-medium whitespace-pre-line">
                {selectedVersionInfo.upgradeNote}
              </span>
            )}
          </>
        }
        confirmText="Upgrade"
        onConfirm={() => {
          setLastAction('upgrade');
          startUpgrade(selectedVersion);
          setConfirmUpgradeOpen(false);
        }}
        onCancel={() => setConfirmUpgradeOpen(false)}
        onCloseAutoFocus={(e) => {
          // Once the upgrade starts, the button that opened this dialog is disabled, so the
          // default focus return would drop to <body>. Send it to the progress panel.
          if ((upgradeBusy || upgradeInProgress) && upgradeStatusRef.current) {
            e.preventDefault();
            upgradeStatusRef.current.focus();
          }
        }}
      />

      {/* Restore / downgrade: destructive, so kept visually separate. */}
      {restorePoints.length > 0 && (
        <div className={`mt-8 space-y-3 border-t pt-6 ${SETTINGS_WIDE}`}>
          <h2 className="text-destructive text-base font-semibold">Restore a previous version</h2>
          {/* The table below wants the width; this warning does not. */}
          <p className={`text-muted-foreground text-sm ${SETTINGS_READABLE}`}>
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

      <ConfirmDialog
        open={restoreTarget !== null}
        variant="destructive"
        busy={downgradeBusy}
        title={`Restore and downgrade to ${restoreTarget?.version ?? ''}?`}
        description={
          <>
            This restores the database backup from{' '}
            <span className="font-mono">
              {restoreTarget ? formatBackupTsLocal(restoreTarget.backup) : ''}
            </span>{' '}
            and runs <span className="font-mono">{restoreTarget?.version}</span>. Everything created
            since that backup (submissions, grades, accounts) is{' '}
            <span className="text-destructive font-medium">permanently lost</span>. A safety backup
            of the current state is taken first.
          </>
        }
        requireTypedConfirmation={restoreTarget?.version}
        typedConfirmationLabel={`Type ${restoreTarget?.version ?? ''} to enable the restore button.`}
        confirmText="Restore and downgrade"
        onConfirm={() => {
          if (restoreTarget) {
            setLastAction('downgrade');
            setLastDowngrade({ version: restoreTarget.version, backup: restoreTarget.backup });
            startDowngrade({
              tag: restoreTarget.version,
              restorePoint: restoreTarget.backup,
            });
          }
          setRestoreTarget(null);
        }}
        onCancel={() => setRestoreTarget(null)}
        onCloseAutoFocus={(e) => {
          // The row's Restore button is disabled once the downgrade starts, so send focus
          // to the status panel instead of letting it drop to <body>.
          if ((downgradeBusy || upgradeInProgress) && upgradeStatusRef.current) {
            e.preventDefault();
            upgradeStatusRef.current.focus();
          }
        }}
      />

      {/* Forced downgrade: the updater refused because it couldn't confirm a safety
          backup. Re-issue the same restore with force, so it proceeds without one. */}
      <ConfirmDialog
        open={confirmForceOpen}
        variant="destructive"
        busy={downgradeBusy}
        title="Downgrade without a safety backup?"
        description={
          <>
            A backup of the current state could not be confirmed, so this downgrade to{' '}
            <span className="font-mono">{lastDowngrade?.version}</span> was refused. Proceeding
            anyway restores the older backup and{' '}
            <span className="text-destructive font-medium">
              permanently discards the current state with no way to recover it
            </span>
            . Only do this if you accept that loss.
          </>
        }
        requireTypedConfirmation={lastDowngrade?.version}
        typedConfirmationLabel={`Type ${lastDowngrade?.version ?? ''} to enable the downgrade button.`}
        confirmText="Downgrade anyway"
        onConfirm={() => {
          if (lastDowngrade) {
            setLastAction('downgrade');
            startDowngrade({
              tag: lastDowngrade.version,
              restorePoint: lastDowngrade.backup,
              force: true,
            });
          }
          setConfirmForceOpen(false);
        }}
        onCancel={() => setConfirmForceOpen(false)}
        onCloseAutoFocus={(e) => {
          if ((downgradeBusy || upgradeInProgress) && upgradeStatusRef.current) {
            e.preventDefault();
            upgradeStatusRef.current.focus();
          }
        }}
      />

      {/* Delete a restore point: removes the backup file(s) and drops it from the list.
          Less destructive than a downgrade (nothing in the running app changes), so a
          plain confirm is enough. */}
      <ConfirmDialog
        open={deleteTarget !== null}
        variant="destructive"
        busy={deleteBusy}
        title="Delete this backup?"
        description={
          <>
            This deletes the backup from{' '}
            <span className="font-mono">
              {deleteTarget ? formatBackupTsLocal(deleteTarget.backup) : ''}
            </span>{' '}
            and removes <span className="font-mono">{deleteTarget?.version}</span> from the restore
            list, so you can no longer downgrade to it. It does not affect the running application.
          </>
        }
        confirmText="Delete backup"
        onConfirm={() => {
          if (deleteTarget) startDeleteRestorePoint(deleteTarget.backup);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
