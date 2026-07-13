'use client';

import React, { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/query-fetch';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import type { FilesStatusResponse } from '@/lib/status/types';
import { Loading, Stat, Section, useStatusQuery } from '../status-ui';

export default function FilesTab({
  active,
  autoRefresh,
}: {
  active: boolean;
  autoRefresh: boolean;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useStatusQuery<FilesStatusResponse>({
    queryKey: queryKeys.admin.statusFiles(),
    path: apiPaths.admin.statusFiles(),
    active,
    autoRefresh,
  });

  const {
    mutate: deleteFile,
    isPending,
    variables,
  } = useMutation({
    mutationFn: (vars: { category: string; fileName: string }) =>
      fetchJson(apiPaths.admin.statusFiles(), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.statusFiles() });
    },
    onError: (err) => {
      console.error('Delete abandoned file error:', err);
      window.alert(err instanceof Error ? err.message : 'Failed to delete file');
    },
  });

  const onDelete = useCallback(
    (category: string, fileName: string) => {
      if (isPending) return;
      if (!window.confirm(`Delete abandoned file "${fileName}"?`)) return;
      deleteFile({ category, fileName });
    },
    [isPending, deleteFile],
  );

  if (isLoading || !data) {
    return <Loading />;
  }

  const files = data.abandonedFiles;

  return (
    <Section
      title={
        <>
          Abandoned Files
          <Badge variant="neutral">Total: {files.total}</Badge>
        </>
      }
    >
      <div className="max-w-xl space-y-4">
        <div className="space-y-2">
          {Object.entries(files.byCategory).map(([k, v]) => (
            <Stat key={k} label={k} value={v} />
          ))}
        </div>

        {files.samples.length ? (
          <div className="rounded border">
            <div className="text-muted-foreground border-b px-3 py-2 text-xs font-semibold">
              Sample files (max 50)
            </div>
            <ul className="max-h-72 overflow-auto px-3 py-2 text-xs">
              {files.samples.map((f, i) => {
                const deleting =
                  isPending &&
                  variables?.category === f.category &&
                  variables?.fileName === f.fileName;
                return (
                  <li
                    key={`${f.category}-${f.fileName}-${i}`}
                    className="mb-1 flex items-start justify-between gap-2 last:mb-0"
                  >
                    <div className="min-w-0">
                      <span className="bg-muted mr-2 rounded px-1.5 py-0.5 text-[10px] uppercase">
                        {f.category}
                      </span>
                      <span className="break-all">{f.path}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={deleting}
                      onClick={() => onDelete(f.category, f.fileName)}
                      aria-label={`Delete abandoned file ${f.fileName}`}
                    >
                      {deleting ? 'Deleting…' : 'Delete'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="text-sm">No abandoned files found.</div>
        )}
      </div>
    </Section>
  );
}
