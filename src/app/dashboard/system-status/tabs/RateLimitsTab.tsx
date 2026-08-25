'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { fetchJson } from '@/lib/query-fetch';
import { DataTable } from '@/components/ui/data-table';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import type { RateLimitedAddress, RateLimitsStatusResponse } from '@/lib/status/types';
import { STATUS_WIDE, StatusSection, useStatusQuery } from '../status-ui';
import { getRateLimitColumns } from '../rate-limit-columns';

export default function RateLimitsTab({
  active,
  autoRefresh,
}: {
  active: boolean;
  autoRefresh: boolean;
}) {
  const { timezone } = useEffectiveTimezone();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');

  const { data, isLoading } = useStatusQuery<RateLimitsStatusResponse>({
    queryKey: queryKeys.admin.statusRateLimits(),
    path: apiPaths.admin.statusRateLimits(),
    active,
    autoRefresh,
  });

  const clearLimit = useMutation({
    mutationFn: (entry: RateLimitedAddress) =>
      fetchJson<{ success: boolean }>(apiPaths.admin.statusRateLimitsClear(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: entry.scope, ip: entry.ip }),
      }),
    onSuccess: (_result, entry) => {
      setStatus(`Cleared the restriction on ${entry.ip}.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.statusRateLimits() });
    },
    onError: (error: unknown, entry) => {
      const message = error instanceof Error ? error.message : 'Please try again.';
      setStatus(`Could not clear the restriction on ${entry.ip}. ${message}`);
    },
  });

  const entries = data?.entries ?? [];
  // Fall back to the browser clock only before the first response, when there are no
  // rows to measure against anyway.
  const generatedAt = data?.generatedAt ?? Date.now();
  const clearingIp = clearLimit.isPending ? (clearLimit.variables?.ip ?? null) : null;
  const { mutate: clear } = clearLimit;

  const columns = useMemo(
    () =>
      getRateLimitColumns({
        timeZone: timezone,
        generatedAt,
        onClear: (entry) => clear(entry),
        clearingIp,
      }),
    [timezone, generatedAt, clearingIp, clear],
  );

  return (
    <StatusSection
      title={`Rate Limits${entries.length ? ` (${entries.length})` : ''}`}
      description="Addresses AFCT is currently turning away for making too many sign-in, sign-up, or email-availability requests."
      boxed={false}
      className={STATUS_WIDE}
    >
      {/* The operational detail an admin needs before clearing one, kept out of the
          description so the section still opens with what the list is. */}
      <p className="text-muted-foreground max-w-4xl text-sm">
        Each restriction lifts on its own at the time shown; clear one only when you know the
        traffic is legitimate, such as a classroom or office where everyone shares an address.
        Restrictions are held in memory, so this list also resets whenever the app restarts.
      </p>

      <div aria-live="polite" className="sr-only">
        {status}
      </div>

      <DataTable
        columns={columns}
        data={entries}
        loading={isLoading}
        storageKey="system-status-rate-limits"
        tableLabel="Rate-limited IP addresses"
        emptyIcon={ShieldCheck}
        emptyTitle="No IP addresses are currently rate limited"
        emptyDescription="Addresses appear here when they make too many sign-in, sign-up, or email-availability requests."
        defaultSorting={[{ id: 'startedAt', desc: true }]}
        // No toolbar: this is a short operational list, not something to search or export.
        // The two filter-only columns went with it, since the Filters popover was the only
        // thing that could reach them and their detail is already in the IP and Seen before
        // cells.
        showToolbar={false}
      />
    </StatusSection>
  );
}
