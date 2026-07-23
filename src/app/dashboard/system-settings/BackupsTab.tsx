'use client';

import { Button } from '@/components/ui/button';
import InputGroup from '@/components/ui/InputGroup';
import SwitchField from '@/components/ui/SwitchField';
import { apiPaths } from '@/lib/api-paths';
import {
  MIN_BACKUP_HOUR,
  MAX_BACKUP_HOUR,
  MIN_BACKUP_RETENTION_DAYS,
  MAX_BACKUP_RETENTION_DAYS,
} from '@/lib/system-settings';
import { useBackups } from './useBackups';
import { formatBackupTs, formatBytes, type FormSnapshot, type SetField } from './system-settings-shared';

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
          boxClassName="border-black"
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
          description={`24-hour clock, server time (UTC). ${MIN_BACKUP_HOUR}–${MAX_BACKUP_HOUR}. e.g. 2 = 2:00 AM.`}
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
          description={`Older dumps are deleted. ${MIN_BACKUP_RETENTION_DAYS}–${MAX_BACKUP_RETENTION_DAYS} days.`}
        />
      </div>
      <p className="text-muted-foreground mt-3 text-xs">
        Backups are stored on the server. Copy them off-host regularly — on-host backups don’t
        survive host loss.
      </p>

      <div className="mt-6 space-y-3">
        <h3 className="text-sm font-medium">Available backups</h3>
        <Button
          type="button"
          size="sm"
          onClick={handleBackupNow}
          disabled={disabled || backupNowBusy}
        >
          {backupNowBusy ? 'Requesting…' : 'Back up now'}
        </Button>

        {backupsLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : backups.length === 0 ? (
          <p className="text-muted-foreground text-sm">No backups yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm" aria-label="Available backups">
              <thead className="bg-muted/30 text-left">
                <tr>
                  <th scope="col" className="p-2 font-medium">
                    Taken (server time)
                  </th>
                  <th scope="col" className="p-2 font-medium">
                    Archive
                  </th>
                  <th scope="col" className="p-2 font-medium">
                    Encryption
                  </th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.timestamp} className="border-t">
                    <td className="p-2 whitespace-nowrap">{formatBackupTs(b.timestamp)}</td>
                    <td className="p-2">
                      <a
                        className="text-sky-600 underline"
                        href={apiPaths.admin.backupDownload({ file: b.file })}
                      >
                        Download ({formatBytes(b.size)})
                      </a>
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {b.encrypted ? (
                        'Encrypted'
                      ) : (
                        <span className="text-amber-600">Not encrypted</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted-foreground text-xs">
          Each archive holds the database and the uploaded files together, so one download is a
          complete, restorable copy. Keep one off-host — and if backups are encrypted, store the
          passphrase somewhere other than this server, or they cannot be restored.
        </p>
      </div>
    </>
  );
}
