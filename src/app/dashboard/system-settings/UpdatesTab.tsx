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
import { useUpgrade, isUpgradeInProgress } from './useUpgrade';
import { upgradePhaseLabel, formatBackupTs } from './system-settings-shared';
import { UpgradeProgress } from './UpgradeProgress';
import { UpgradeLiveLog } from './UpgradeLiveLog';

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
    startUpgrade,
    startDowngrade,
    startSelfUpdate,
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
  // Which flow the admin last kicked off, so the progress checklist labels its steps
  // correctly (upgrade and downgrade share some early phases).
  const [lastAction, setLastAction] = useState<'upgrade' | 'downgrade' | null>(null);

  const upgradeInProgress = isUpgradeInProgress(upgradeInfo?.status);
  const upgradeableVersions = (upgradeInfo?.versions ?? []).filter(
    (v) => v.tag !== upgradeInfo?.current,
  );
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
      cell: ({ row }) => (
        <span className="whitespace-nowrap">{formatBackupTs(row.original.backup)}</span>
      ),
      meta: { priority: 1 },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      meta: { align: 'right', priority: 1 },
      cell: ({ row }) => (
        <Button
          type="button"
          size="sm"
          variant="destructive"
          aria-label={`Restore version ${row.original.version}`}
          disabled={disabled || downgradeBusy || upgradeInProgress}
          onClick={() => {
            setRestoreTarget({ version: row.original.version, backup: row.original.backup });
            setRestoreConfirmText('');
          }}
        >
          Restore
        </Button>
      ),
    },
  ];

  return (
    <>
      <p className="text-muted-foreground mb-4 text-sm">
        Upgrade AFCT to a newer published release. The stack backs up the database first, downloads
        the new version, and restarts; if the new version fails its health check it is rolled back
        automatically.
      </p>

      <div className="max-w-2xl space-y-5 xl:max-w-4xl">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Current version</h3>
          <Badge variant="secondary" className="w-fit font-mono">
            {upgradeLoading && !upgradeInfo ? 'Loading…' : (upgradeInfo?.current ?? 'unknown')}
          </Badge>
        </div>

        {/* The updater sidecar tracks the app version but is recreated on its own, so it
            can lag after an app upgrade. Offer to bring it up to date from here rather
            than at the console. Hidden when it matches or hasn't reported a version. */}
        {upgradeInfo?.updaterVersion &&
          upgradeInfo.updaterVersion !== upgradeInfo.current &&
          !upgradeInProgress && (
            <div
              role="note"
              className="max-w-xl space-y-2 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <p>
                The update service is on <span className="font-mono">{upgradeInfo.updaterVersion}</span>,
                behind the app&apos;s <span className="font-mono">{upgradeInfo.current}</span>. Update it
                so future upgrades use the latest logic.
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={disabled || selfUpdateBusy}
                onClick={() => startSelfUpdate(upgradeInfo.current)}
              >
                {selfUpdateBusy ? 'Updating…' : 'Update the update service'}
              </Button>
            </div>
          )}

        {upgradeInfo?.status?.phase && (
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
                  check — making a not-yet-started upgrade look already done. */}
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
            {selectedVersionInfo?.requiresHostUpdate && (
              <div
                role="note"
                className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              >
                This release also updates a component the in-app upgrade can’t replace on its own.
                After the upgrade finishes, run{' '}
                <code className="font-mono">sh install.sh update</code> on the server to complete it.
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
            {selectedVersionInfo?.requiresHostUpdate && (
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                Afterward, run <code className="font-mono">sh install.sh update</code> on the server
                to finish updating a component the app can’t replace itself.
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

      {/* Restore / downgrade — destructive, so kept visually separate. */}
      {restorePoints.length > 0 && (
        <div className="mt-8 max-w-2xl space-y-3 border-t pt-6 xl:max-w-4xl">
          <h3 className="text-destructive text-sm font-semibold">Restore a previous version</h3>
          <p className="text-muted-foreground text-sm">
            Downgrading restores the database backup taken before that version was replaced. It{' '}
            <span className="text-destructive font-medium">
              permanently discards everything created since that backup
            </span>{' '}
            — submissions, grades, and accounts. Use this only for recovery.
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
                {restoreTarget ? formatBackupTs(restoreTarget.backup) : ''}
              </span>{' '}
              and runs <span className="font-mono">{restoreTarget?.version}</span>. Everything created
              since that backup — submissions, grades, accounts — is{' '}
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
    </>
  );
}
