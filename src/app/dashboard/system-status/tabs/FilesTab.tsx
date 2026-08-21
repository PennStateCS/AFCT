'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileWarning, FolderCheck, HardDrive, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { fetchJson } from '@/lib/query-fetch';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { showToast } from '@/lib/toast';
import type { AbandonedFile, FilesStatusResponse } from '@/lib/status/types';
import { formatBytes } from '../status-format';
import { abandonedFileColumns } from '../abandoned-file-columns';
import { UploadUsagePanel } from '../upload-usage-panel';
import { Loading, Section, useStatusQuery } from '../status-ui';

/** What a delete is waiting on: one named file, or a whole category. */
type Pending =
  | { kind: 'file'; file: AbandonedFile }
  | { kind: 'category'; category: string; label: string; count: number; sizeBytes: number };

export default function FilesTab({
  active,
  autoRefresh,
}: {
  active: boolean;
  autoRefresh: boolean;
}) {
  const queryClient = useQueryClient();
  const { timezone } = useEffectiveTimezone();
  const { data, isLoading } = useStatusQuery<FilesStatusResponse>({
    queryKey: queryKeys.admin.statusFiles(),
    path: apiPaths.admin.statusFiles(),
    active,
    autoRefresh,
  });

  const [pending, setPending] = useState<Pending | null>(null);
  const [status, setStatus] = useState('');
  /**
   * Bumped with every message so the live region is a fresh node each time.
   *
   * Without it, two identical messages in a row are one unchanged string, and a live region
   * announces changes: the second delete of nothing said nothing at all.
   */
  const [statusKey, setStatusKey] = useState(0);
  const announce = useCallback((message: string) => {
    setStatus(message);
    setStatusKey((n) => n + 1);
  }, []);

  const {
    mutateAsync: remove,
    isPending,
    variables,
  } = useMutation({
    mutationFn: (vars: { category: string; fileName?: string; all?: boolean }) =>
      fetchJson<{ ok: true; deleted?: number; freedBytes?: number }>(apiPaths.admin.statusFiles(), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      }),
    onSuccess: (result, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.statusFiles() });
      /**
       * One announcement per delete.
       *
       * The toast announces through its own live region, so writing the same sentence into the
       * region below read it out twice. The region keeps the detail, because a toast is gone in
       * a few seconds and this is the record of what was removed; the toast keeps only the
       * short confirmation.
       */
      if (vars.all) {
        const freed = formatBytes(result?.freedBytes ?? 0);
        announce(`Deleted ${result?.deleted ?? 0} files, freeing ${freed}.`);
        showToast.success('Files deleted');
      } else {
        announce(`Deleted ${vars.fileName}.`);
        showToast.deleted('File', { name: vars.fileName });
      }
    },
    onError: (err) => {
      console.error('Delete abandoned file error:', err);
      const message =
        err instanceof Error
          ? err.message
          : 'Could not delete the file. Check your connection and try again.';
      // Only the toast. It is the visible feedback and it already announces assertively
      // through its own live region, so also writing here read the failure out twice.
      showToast.error(message);
    },
  });

  const onDeleteFile = useCallback(
    (file: AbandonedFile) => {
      if (isPending) return;
      setPending({ kind: 'file', file });
    },
    [isPending],
  );

  const files = data?.abandonedFiles;
  const storage = data?.storage;
  const labels = useMemo(
    () => Object.fromEntries((files?.categories ?? []).map((c) => [c.category, c.label])),
    [files?.categories],
  );
  // Which row shows "Deleting..."; a fresh object each render would rebuild the columns every
  // time, so it is derived inside the memo from the two values it actually depends on.
  const deletingCategory = isPending ? variables?.category : undefined;
  const deletingFileName = isPending ? variables?.fileName : undefined;

  const columns = useMemo(
    () =>
      abandonedFileColumns({
        labels,
        timeZone: timezone,
        onDelete: onDeleteFile,
        deleting:
          deletingCategory && deletingFileName
            ? { category: deletingCategory, fileName: deletingFileName }
            : null,
      }),
    [labels, timezone, onDeleteFile, deletingCategory, deletingFileName],
  );

  if (isLoading || !data || !files) {
    return <Loading />;
  }

  // A failed check is not a clean volume. This used to answer any error with zeroes, which read
  // as "nothing to clean up", so a database that could not be reached looked like good news.
  if (files.error) {
    return (
      <Section title="Abandoned files">
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 max-w-3xl space-y-2 rounded border p-4"
        >
          <div className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4" aria-hidden />
            AFCT could not check for abandoned files
          </div>
          <p className="text-muted-foreground text-sm">{files.error}</p>
          <p className="text-muted-foreground text-sm">
            Nothing has been deleted. This is not the same as having nothing to clean up: until the
            check runs, how much is on disk is unknown. Try again, and if it keeps failing look at
            the Database tab, since the check has to read the database to know which files are still
            in use.
          </p>
        </div>
      </Section>
    );
  }

  // A category with nothing in it and nothing wrong with it is noise, so it stays hidden until
  // it has something to say.
  const shown = files.categories.filter((c) => c.count > 0 || c.error);
  const truncated = files.total > files.files.length;

  return (
    <>
      <Section
        title={
          <>
            <HardDrive className="size-4" aria-hidden />
            Uploaded files
            <Badge variant="neutral">
              {(storage?.inUseCount ?? 0).toLocaleString()} in use,{' '}
              {formatBytes(storage?.inUseBytes ?? 0)}
            </Badge>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-muted-foreground max-w-3xl text-sm">
            Everything students and staff have uploaded: submitted work, reference solutions,
            profile photos and evaluator trials. What is in use is what AFCT still needs. The other
            two figures are the ones to act on, and they are opposites: abandoned files can be
            deleted to free space, while a missing file is one AFCT expects and cannot find.
          </p>

          {(storage?.missingCount ?? 0) > 0 && (
            // Worth an alert of its own. Everything else on this page is housekeeping; this is
            // work AFCT believes it has and cannot produce, which for a submission means a
            // student's file cannot be downloaded, re-graded or appealed.
            <div
              role="alert"
              className="border-destructive/40 bg-destructive/5 max-w-3xl space-y-1 rounded border p-3"
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileWarning className="size-4" aria-hidden />
                {storage?.missingCount} file{storage?.missingCount === 1 ? ' is' : 's are'} recorded
                but not on the server
              </div>
              <p className="text-muted-foreground text-sm">
                Something in AFCT points at {storage?.missingCount === 1 ? 'a file' : 'files'} that
                cannot be found on disk, so {storage?.missingCount === 1 ? 'it' : 'they'} cannot be
                downloaded or re-graded. This is not something deleting anything will fix: it
                usually means files were restored from a backup without the uploads, or removed from
                the server by hand. The affected kinds are marked below.
              </p>
            </div>
          )}

          {storage && <UploadUsagePanel storage={storage} />}
        </div>
      </Section>

      <Section
        title={
          <>
            Abandoned files
            <Badge variant="neutral">
              {files.total} file{files.total === 1 ? '' : 's'}, {formatBytes(files.totalSizeBytes)}
            </Badge>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-muted-foreground max-w-3xl text-sm">
            Files still on the server that nothing in AFCT points at any more, usually left behind
            when the record that used them was deleted. They are safe to remove: nothing in the app
            can reach them, and a file is only listed here after AFCT has checked that no course,
            problem, submission or account still uses it. Deleting one cannot be undone.
          </p>

          {/* The key resets the node on each message, so repeating an action whose wording is
              identical (deleting nothing twice, say) still announces rather than looking
              unchanged and staying silent. */}
          <div key={statusKey} aria-live="polite" className="sr-only">
            {status}
          </div>

          {shown.length > 0 && (
            <ul className="max-w-3xl space-y-2">
              {shown.map((c) => (
                <li
                  key={c.category}
                  className="flex flex-wrap items-center justify-between gap-3 rounded border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{c.label}</div>
                    <div className="text-muted-foreground text-xs">
                      {c.error ? (
                        <span className="text-destructive">{c.error}</span>
                      ) : (
                        <>
                          {c.count} file{c.count === 1 ? '' : 's'} &middot;{' '}
                          {formatBytes(c.sizeBytes)}
                        </>
                      )}
                    </div>
                  </div>
                  {c.count > 0 && (
                    // The whole reason this exists: the volume this page finds holds thousands
                    // of files, and deleting them one dialog at a time is not something anybody
                    // will finish.
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() =>
                        setPending({
                          kind: 'category',
                          category: c.category,
                          label: c.label,
                          count: c.count,
                          sizeBytes: c.sizeBytes,
                        })
                      }
                      aria-label={`Delete all ${c.count} abandoned ${c.label} files`}
                    >
                      Delete all {c.count}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {truncated && (
            <p className="text-muted-foreground text-sm">
              Showing the {files.files.length} largest of {files.total} files. The totals above
              cover all of them, and so does <strong>Delete all</strong>.
            </p>
          )}

          <DataTable
            columns={columns}
            data={files.files}
            storageKey="system-status-abandoned-files"
            tableLabel="Abandoned files"
            emptyIcon={FolderCheck}
            emptyTitle="No abandoned files"
            emptyDescription="Every uploaded file on the server is still in use by something in AFCT."
            defaultSorting={[{ id: 'sizeBytes', desc: true }]}
          />
        </div>
      </Section>

      <ConfirmDialog
        open={!!pending}
        variant="destructive"
        busy={isPending}
        title={pending?.kind === 'category' ? 'Delete all of these files?' : 'Delete this file?'}
        description={
          pending?.kind === 'category'
            ? `This permanently removes ${pending.count} ${pending.label.toLowerCase()} ` +
              `file${pending.count === 1 ? '' : 's'} from the server, freeing ${formatBytes(pending.sizeBytes)}. ` +
              'Each one is checked again as it goes, so anything that has come back into use is left alone. ' +
              'This cannot be undone.'
            : pending?.kind === 'file'
              ? `This permanently removes "${pending.file.fileName}" (${formatBytes(pending.file.sizeBytes)}) from the server and cannot be undone.`
              : undefined
        }
        confirmText={pending?.kind === 'category' ? 'Delete all' : 'Delete file'}
        onConfirm={async () => {
          if (!pending) return;
          try {
            await remove(
              pending.kind === 'category'
                ? { category: pending.category, all: true }
                : { category: pending.file.category, fileName: pending.file.fileName },
            );
          } catch {
            // The mutation's onError surfaces the failure; keep the flow going.
          }
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
