'use client';

import { useRef, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import SelectField from '@/components/ui/SelectField';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { useUpgrade, isUpgradeInProgress, isUpdaterMisconfigured } from './useUpgrade';
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
import {
  SettingsAsideCard,
  SettingsAsideLayout,
  SettingsSection,
  SettingsStatusCard,
  SettingsStatusText,
  type SettingsStatusTone,
} from '@/components/settings/settings-layout';
import { CopyableValue } from './CopyableValue';

/**
 * How an upgrade phase reads as a badge.
 *
 * One place, because the same mapping was written out twice: once beside the current
 * version and once on the status panel, which is two chances for them to disagree about
 * what "rolled_back" looks like.
 */
function upgradePhaseVariant(phase: string): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (phase === 'healthy') return 'success';
  if (phase === 'failed') return 'destructive';
  if (phase === 'rolled_back') return 'warning';
  return 'secondary';
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

  /*
   * Everything about the updater sidecar, in one card in the rail.
   *
   * It used to be three independent things in the main flow: a misconfiguration note, a
   * self-update banner with five phases, and a large orange "not installed" block sitting
   * where the upgrade control should be. They are all the same question ("can this machine
   * perform an upgrade, and if not what do I run"), and stacked as separate banners they
   * pushed the actual workflow down the page.
   *
   * The order below is the old render order made explicit: a self-update in flight wins,
   * because the old banner's guard was `selfUpdate.phase !== 'idle'` and the misconfigured
   * note's was `=== 'idle'`. Not-installed then outranks the rest, because there is no
   * updater to be misconfigured or behind.
   */
  const updateService: {
    tone: SettingsStatusTone;
    badge: string;
    badgeVariant: 'success' | 'warning' | 'danger' | 'neutral';
    headline: string;
    body: React.ReactNode;
  } = (() => {
    if (selfUpdate.phase === 'updating') {
      return {
        tone: 'warn' as const,
        badge: 'Updating',
        badgeVariant: 'warning' as const,
        headline: 'The update service is restarting',
        body: (
          <SettingsStatusText>
            Updating to <span className="font-mono">{selfUpdate.targetTag}</span>. It restarts as
            part of this, so it may briefly show as unavailable. This can take a minute or two.
          </SettingsStatusText>
        ),
      };
    }
    if (selfUpdate.phase === 'done') {
      return {
        tone: 'ok' as const,
        badge: 'Updated',
        badgeVariant: 'success' as const,
        headline: 'The update service is up to date',
        body: (
          <>
            <SettingsStatusText>
              Now on <span className="font-mono">{selfUpdate.targetTag}</span>.
            </SettingsStatusText>
            <Button type="button" size="sm" variant="outline" onClick={dismissSelfUpdate}>
              Dismiss
            </Button>
          </>
        ),
      };
    }
    if (selfUpdate.phase === 'failed') {
      return {
        tone: 'bad' as const,
        badge: 'Update failed',
        badgeVariant: 'danger' as const,
        headline: 'The update service could not be updated',
        body: (
          <>
            {selfUpdate.message ? (
              <SettingsStatusText>{selfUpdate.message}</SettingsStatusText>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled || selfUpdateBusy || !upgradeInfo}
                onClick={() => upgradeInfo && startSelfUpdate(upgradeInfo.current)}
              >
                {selfUpdateBusy ? 'Updating…' : 'Try again'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={dismissSelfUpdate}>
                Dismiss
              </Button>
            </div>
          </>
        ),
      };
    }
    if (selfUpdate.phase === 'timeout') {
      return {
        tone: 'warn' as const,
        badge: 'Taking longer than expected',
        badgeVariant: 'warning' as const,
        headline: 'The update service has not come back yet',
        body: (
          <>
            <SettingsStatusText>
              Reload this page in a moment. If it is still behind, run{' '}
              <code className="font-mono">sh install.sh update</code> on the server.
            </SettingsStatusText>
            <Button type="button" size="sm" variant="outline" onClick={dismissSelfUpdate}>
              Dismiss
            </Button>
          </>
        ),
      };
    }
    if (!updaterAvailable) {
      // A configuration state, not a failure: nothing is broken, a component is simply off.
      return {
        tone: 'warn' as const,
        badge: 'Not installed',
        badgeVariant: 'warning' as const,
        headline: 'In-app upgrades are unavailable',
        body: (
          <>
            <SettingsStatusText>
              Upgrades and downgrades need the privileged updater component. It holds the Docker
              socket, so it is off by default. Enable it on the server, in the directory that
              contains <code className="font-mono">docker-compose.yml</code>:
            </SettingsStatusText>
            <CopyableValue
              value="sh install.sh enable-updater"
              copyName="updater installation command"
            />
            <SettingsStatusText>
              Then reopen this tab. If your installer predates this command, run{' '}
              <code className="font-mono">sh install.sh self-update</code> first.
            </SettingsStatusText>
          </>
        ),
      };
    }
    if (updaterMisconfigured && !upgradeInProgress) {
      // The updater can be the CURRENT version and still unable to upgrade: a container
      // keeps the file paths it was created with. Updating it recreates it, which is the fix.
      return {
        tone: 'warn' as const,
        badge: 'Needs restart',
        badgeVariant: 'warning' as const,
        headline: 'The update service cannot upgrade yet',
        body: (
          <>
            <SettingsStatusText>
              It is running, but it cannot find the{' '}
              {!upgradeInfo?.updaterReadiness?.envFileOk ? 'settings file' : 'stack file'} it has to
              change:{' '}
              <span className="font-mono break-all">
                {!upgradeInfo?.updaterReadiness?.envFileOk
                  ? upgradeInfo?.updaterReadiness?.envFile
                  : upgradeInfo?.updaterReadiness?.composeFile}
              </span>
              . This happens when it has been running since before the file moved. Upgrades will
              fail until it is restarted on the current configuration.
            </SettingsStatusText>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || selfUpdateBusy || !upgradeInfo}
              onClick={() => upgradeInfo && startSelfUpdate(upgradeInfo.current)}
            >
              {selfUpdateBusy ? 'Restarting…' : 'Update the update service'}
            </Button>
          </>
        ),
      };
    }
    if (
      !!upgradeInfo?.updaterVersion &&
      upgradeInfo.updaterVersion !== upgradeInfo.current &&
      !upgradeInProgress
    ) {
      return {
        tone: 'warn' as const,
        badge: 'Update available',
        badgeVariant: 'warning' as const,
        headline: 'The update service is behind the app',
        body: (
          <>
            <SettingsStatusText>
              On <span className="font-mono">{upgradeInfo.updaterVersion}</span>, behind{' '}
              <span className="font-mono">{upgradeInfo.current}</span>. Update it so future upgrades
              use the latest logic.
            </SettingsStatusText>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || selfUpdateBusy || !upgradeInfo}
              onClick={() => upgradeInfo && startSelfUpdate(upgradeInfo.current)}
            >
              {selfUpdateBusy ? 'Updating…' : 'Update the update service'}
            </Button>
          </>
        ),
      };
    }
    return {
      tone: 'ok' as const,
      badge: 'Ready',
      badgeVariant: 'success' as const,
      headline: 'The update service is ready',
      body: (
        <>
          {upgradeInfo?.updaterVersion ? (
            <div className="space-y-0.5">
              <div className="text-muted-foreground text-xs">Version</div>
              <div className="text-foreground font-mono text-sm break-all">
                {upgradeInfo.updaterVersion}
              </div>
            </div>
          ) : null}
          <SettingsStatusText>It performs upgrades and rollbacks for AFCT.</SettingsStatusText>
        </>
      ),
    };
  })();

  return (
    <>
      <SettingsAsideLayout
        // Main workflow first when stacked: this is a page you act on, not a page you read.
        asidePlacement="after"
        aside={
          <>
            <SettingsStatusCard
              title="Update service"
              tone={updateService.tone}
              badge={<Badge variant={updateService.badgeVariant}>{updateService.badge}</Badge>}
              headline={updateService.headline}
            >
              {updateService.body}
            </SettingsStatusCard>

            <SettingsAsideCard title="Command-line update">
              <div className="space-y-3">
                <SettingsStatusText>
                  Run this from the directory that holds{' '}
                  <code className="font-mono">docker-compose.yml</code>:
                </SettingsStatusText>
                <CopyableValue
                  value="sh install.sh update"
                  copyName="command-line update command"
                  description="It does the same backup, version swap and health check as an in-app upgrade."
                />
              </div>
            </SettingsAsideCard>
          </>
        }
      >
        <SettingsSection title="Current version">
          <div className="flex flex-wrap items-center gap-2">
            {/* The version is metadata, not a state: secondary, never a status colour. The
                health badge beside it is what carries state. */}
            <Badge variant="secondary" className="font-mono">
              {upgradeLoading && !upgradeInfo ? 'Loading…' : (upgradeInfo?.current ?? 'unknown')}
            </Badge>
            {upgradeInfo?.status?.phase && (
              <Badge variant={upgradePhaseVariant(upgradeInfo.status.phase)}>
                {upgradePhaseLabel(upgradeInfo.status.phase)}
              </Badge>
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          title="Upgrade AFCT"
          description="Install a newer published release. AFCT backs up the database first and rolls back automatically if the new release fails its health check."
        >
          {!updaterAvailable ? (
            // Not a banner here: the rail card carries the state and the command. What this
            // needs to say is only why there is no button.
            <p className="text-muted-foreground text-sm">
              In-app upgrades need the update service, which is not installed on this server. See
              Update service for how to enable it.
            </p>
          ) : upgradeInfo?.manifestError ? (
            <p className="text-muted-foreground text-sm">
              The list of available versions could not be loaded. Check the server&apos;s network
              access and reopen this tab to retry.
            </p>
          ) : upgradeableVersions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {upgradeLoading
                ? 'Loading available versions…'
                : 'AFCT is on the latest available version.'}
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                {upgradeableVersions.length === 1
                  ? 'A newer release is available.'
                  : `${upgradeableVersions.length} newer releases are available.`}
              </p>
              <div className="max-w-md">
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
              </div>
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
                onClick={() => setConfirmUpgradeOpen(true)}
                disabled={disabled || upgradeBusy || upgradeInProgress || !selectedVersion}
              >
                {upgradeBusy || upgradeInProgress ? 'Upgrading…' : 'Upgrade…'}
              </Button>
            </div>
          )}
        </SettingsSection>

        {/* The self-update has its own card in the rail; hide this while one runs so the
            updater's transient phases don't show as an app upgrade too. */}
        {upgradeInfo?.status?.phase && selfUpdate.phase === 'idle' && (
          <SettingsSection title="Update status" className="scroll-mt-6">
            {/* role="status": phase changes arrive via background polling, so announce them
                to screen readers as they happen. tabIndex so the upgrade dialog can return
                focus here once the button that opened it is disabled. */}
            <div role="status" className="space-y-2 text-sm" ref={upgradeStatusRef} tabIndex={-1}>
              <Badge variant={upgradePhaseVariant(upgradeInfo.status.phase)} className="w-fit">
                {upgradePhaseLabel(upgradeInfo.status.phase)}
              </Badge>
              {upgradeInfo.status.message && (
                <p className="text-muted-foreground">{upgradeInfo.status.message}</p>
              )}
              {/* The downgrade was refused because no safety backup could be confirmed.
                  Nothing was changed, so offer to proceed anyway (an explicit choice to
                  discard the current state), behind its own type-to-confirm dialog. It
                  stays here, with the restore workflow it belongs to, not in the rail. */}
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
              {/* Once a run this session settles, show where things landed. Gated on
                  lastAction so a leftover "healthy" from a previous session doesn't render
                  this on a fresh page load. */}
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
          </SettingsSection>
        )}

        {/* Restore / downgrade: destructive, so kept visually separate and last. */}
        {restorePoints.length > 0 && (
          <SettingsSection
            title="Restore points"
            description="AFCT keeps the backup taken before each upgrade, so an earlier version can be restored if one goes wrong."
          >
            <p className="text-muted-foreground text-sm">
              Restoring a point puts back the database backup taken before that version was
              replaced. It{' '}
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
          </SettingsSection>
        )}
      </SettingsAsideLayout>

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
