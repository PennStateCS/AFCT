'use client';

import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import InputGroup from '@/components/ui/InputGroup';
import SwitchField from '@/components/ui/SwitchField';
import { DataTable } from '@/components/ui/data-table';
import { apiPaths } from '@/lib/api-paths';
import {
  MIN_BACKUP_HOUR,
  MAX_BACKUP_HOUR,
  MIN_BACKUP_RETENTION_DAYS,
  MAX_BACKUP_RETENTION_DAYS,
} from '@/lib/system-settings';
import { useBackups } from './useBackups';
import {
  formatBackupTs,
  formatBackupTsLocal,
  formatBytes,
  type FormSnapshot,
  type SetField,
} from './system-settings-shared';

/** Backups tab: schedule settings plus the available-backups list and "Back up now". */
export function BackupsTab({
  form,
  setField,
  disabled,
}: {
  form: FormSnapshot;
  setField: SetField;
  disabled: boolean;
}) {
  const { backups, backupsLoading, backupNowBusy, handleBackupNow } = useBackups();

  type BackupRow = (typeof backups)[number];
  const columns = useMemo<ColumnDef<BackupRow>[]>(
    () => [
      {
        accessorKey: 'timestamp',
        header: 'Taken (local time)',
        // Shown in the viewer's timezone; the raw server (UTC) time is in the tooltip
        // for correlating with server logs.
        cell: ({ row }) => (
          <span
            className="whitespace-nowrap"
            title={`${formatBackupTs(row.original.timestamp)} UTC`}
          >
            {formatBackupTsLocal(row.original.timestamp)}
          </span>
        ),
        meta: { priority: 1 },
      },
      {
        id: 'archive',
        header: 'Archive',
        enableSorting: false,
        cell: ({ row }) => (
          <a
            className="text-primary underline"
            href={apiPaths.admin.backupDownload({ file: row.original.file })}
          >
            Download ({formatBytes(row.original.size)})
          </a>
        ),
        meta: { priority: 1 },
      },
      {
        id: 'encryption',
        header: 'Encryption',
        accessorFn: (b) => (b.encrypted ? 'Encrypted' : 'Not encrypted'),
        cell: ({ row }) =>
          row.original.encrypted ? (
            <span className="whitespace-nowrap">Encrypted</span>
          ) : (
            <span className="whitespace-nowrap text-status-warning">Not encrypted</span>
          ),
        meta: { priority: 2 },
      },
    ],
    [],
  );

  return (
    <>
      <p className="text-muted-foreground mb-4 text-sm">
        Automatic database backups. Dumps are taken on the server and pruned after the retention
        window.
      </p>
      <div className="max-w-md space-y-5">
        <SwitchField
          id="backup-enabled"
          name="backup-enabled"
          label="Enable automatic backups"
          checked={form.backupEnabled}
          onCheckedChange={(v) => setField('backupEnabled', v)}
          disabled={disabled}
          descriptionPlacement="inline"
          description="When off, no scheduled dumps are taken."
          boxClassName="border-input"
        />
        <InputGroup
          label="Daily backup time (hour)"
          name="backupHour"
          type="number"
          required
          requiredMark
          min={MIN_BACKUP_HOUR}
          max={MAX_BACKUP_HOUR}
          value={form.backupHour === '' ? '' : String(form.backupHour)}
          setValue={(val) => setField('backupHour', val === '' ? '' : Number(val))}
          disabled={disabled || !form.backupEnabled}
          description={`24-hour clock, server time (UTC). ${MIN_BACKUP_HOUR}-${MAX_BACKUP_HOUR}. e.g. 2 = 2:00 AM.`}
        />
        <InputGroup
          label="Retention (days)"
          name="backupRetentionDays"
          type="number"
          required
          requiredMark
          min={MIN_BACKUP_RETENTION_DAYS}
          max={MAX_BACKUP_RETENTION_DAYS}
          value={form.backupRetentionDays === '' ? '' : String(form.backupRetentionDays)}
          setValue={(val) => setField('backupRetentionDays', val === '' ? '' : Number(val))}
          disabled={disabled || !form.backupEnabled}
          description={`Older dumps are deleted. ${MIN_BACKUP_RETENTION_DAYS}-${MAX_BACKUP_RETENTION_DAYS} days.`}
        />
      </div>
      <p className="text-muted-foreground mt-3 text-xs">
        Backups are stored on the server. Copy them off-host regularly — on-host backups don’t
        survive host loss.
      </p>

      <div className="mt-6 space-y-3">
        <h2 className="text-sm font-medium">Available backups</h2>
        <Button
          type="button"
          size="sm"
          onClick={handleBackupNow}
          disabled={disabled || backupNowBusy}
        >
          {backupNowBusy ? 'Requesting…' : 'Back up now'}
        </Button>

        <DataTable
          columns={columns}
          data={backups}
          loading={backupsLoading}
          storageKey="system-backups"
          tableLabel="Available backups"
          // Small, self-contained list: no search/filter/columns/export toolbar. Sortable
          // headers, pagination and the mobile card view still come from DataTable.
          showToolbar={false}
          defaultSorting={[{ id: 'timestamp', desc: true }]}
          loadingMessage="Loading backups, please wait..."
          emptyTitle="No backups yet"
          emptyDescription="Scheduled dumps appear here once taken. Use Back up now to create one."
        />
        <p className="text-muted-foreground text-xs">
          Each archive holds the database and the uploaded files together, so one download is a
          complete, restorable copy. Keep one off-host — and if backups are encrypted, store the
          passphrase somewhere other than this server, or they cannot be restored.
        </p>
      </div>
    </>
  );
}
