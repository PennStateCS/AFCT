'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query-fetch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date-format';
import type { IpDetails, RateLimitedAddress, RateLimitsStatusResponse } from '@/lib/status/types';
import { Loading, Section, useStatusQuery, copy } from '../status-ui';
// The server sends `generatedAt` alongside the entries, so every relative time on this
// tab is measured against the server's clock rather than the browser's.
import { formatRelative } from '../status-format';

/**
 * What could be established about the address itself. A reverse-DNS name is the fastest
 * way to recognise your own campus, so it leads; the classification is the fallback when
 * there is no name to show.
 */
const AddressFacts = ({ details }: { details: IpDetails }) => (
  <div className="text-muted-foreground mt-1 space-y-0.5 text-xs">
    {details.hostname ? (
      <div className="max-w-[32ch] truncate" title={details.hostname}>
        {details.hostname}
      </div>
    ) : (
      <div>
        {details.hostnameLookup === 'skipped' ? 'No name looked up' : 'No reverse DNS name'}
      </div>
    )}
    <div>
      {details.kindLabel}
      {details.version ? ` (IPv${details.version})` : ''}
    </div>
  </div>
);

/** Whether AFCT has seen this address before, from its own activity log. */
const SeenBefore = ({
  details,
  timezone,
}: {
  details: IpDetails;
  timezone: string;
}) => {
  const known = details.knownActivity;
  if (!known) {
    return <span className="text-muted-foreground">Not checked</span>;
  }
  if (known.eventCount === 0) {
    return (
      <span className="text-muted-foreground">
        Not seen in the last {known.windowDays} days
      </span>
    );
  }
  return (
    <div className="space-y-0.5">
      <div>
        {known.accountCount === 0
          ? 'No signed-in accounts'
          : `${known.accountCount} account${known.accountCount === 1 ? '' : 's'}`}
        {known.accountCount > 1 ? ' (shared address)' : ''}
      </div>
      <div className="text-muted-foreground text-xs">
        {known.truncated ? 'at least ' : ''}
        {known.eventCount} event{known.eventCount === 1 ? '' : 's'} in {known.windowDays} days
      </div>
      {known.lastSeen ? (
        <div className="text-muted-foreground text-xs">
          Last seen {formatDateTimeInTimeZone(new Date(known.lastSeen), timezone)}
        </div>
      ) : null}
      {known.accounts.length ? (
        <div
          className="text-muted-foreground max-w-[32ch] truncate text-xs"
          title={known.accounts.join(', ')}
        >
          {known.accounts.join(', ')}
        </div>
      ) : null}
    </div>
  );
};

export default function RateLimitsTab({
  active,
  autoRefresh,
}: {
  active: boolean;
  autoRefresh: boolean;
}) {
  const { timezone } = useEffectiveTimezone();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<RateLimitedAddress | null>(null);
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

  if (isLoading || !data) {
    return <Loading />;
  }

  const { entries, generatedAt } = data;

  const confirmClear = () => {
    const entry = pending;
    setPending(null);
    if (entry) clearLimit.mutate(entry);
  };

  return (
    <Section title={`Rate Limits${entries.length ? ` (${entries.length})` : ''}`}>
      <div className="space-y-4">
        <p className="text-muted-foreground max-w-3xl text-sm">
          Addresses AFCT is currently turning away for making too many sign-in, sign-up, or
          email-availability requests. Each restriction lifts on its own at the time shown;
          clear one only when you know the traffic is legitimate, such as a classroom or
          office where everyone shares an address. Restrictions are held in memory, so this
          list also resets whenever the app restarts.
        </p>

        <div aria-live="polite" className="sr-only">
          {status}
        </div>

        {entries.length ? (
          <div className="overflow-auto rounded border">
            <table className="w-full text-sm" aria-label="Rate-limited IP addresses">
              <caption className="sr-only">
                IP addresses currently blocked or challenged, with what is known about each
                address, the reason, when the restriction began, recent attempts, and when it
                expires
              </caption>
              <thead className="text-muted-foreground text-left text-xs">
                <tr className="border-b">
                  <th scope="col" className="px-3 py-2">
                    IP address
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Seen before
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Reason
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Restricted since
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Recent activity
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Expires
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-0">
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{entry.ip}</span>
                        <button
                          type="button"
                          className="text-muted-foreground text-xs underline hover:opacity-80"
                          onClick={() => copy(entry.ip)}
                          aria-label={`Copy IP address ${entry.ip}`}
                        >
                          Copy
                        </button>
                      </div>
                      <AddressFacts details={entry.details} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <SeenBefore details={entry.details} timezone={timezone} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-col gap-1">
                        <span>{entry.reason}</span>
                        <span>
                          <Badge variant={entry.state === 'blocked' ? 'danger' : 'warning'}>
                            {entry.state === 'blocked' ? 'Blocked' : 'Challenged'}
                          </Badge>{' '}
                          <span className="text-muted-foreground text-xs">
                            {entry.scopeLabel}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div>{formatDateTimeInTimeZone(new Date(entry.startedAt), timezone)}</div>
                      <div className="text-muted-foreground text-xs">
                        {formatRelative(entry.startedAt, generatedAt)}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div>
                        {entry.attempts} attempt{entry.attempts === 1 ? '' : 's'} counted
                        {entry.attemptsWhileRestricted > 0
                          ? `, ${entry.attemptsWhileRestricted} turned away since`
                          : ''}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        Last attempt{' '}
                        {formatDateTimeInTimeZone(new Date(entry.lastAttemptAt), timezone)}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div>{formatDateTimeInTimeZone(new Date(entry.expiresAt), timezone)}</div>
                      <div className="text-muted-foreground text-xs">
                        {formatRelative(entry.expiresAt, generatedAt)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setPending(entry)}
                        disabled={clearLimit.isPending}
                        aria-label={`Clear the restriction on ${entry.ip}`}
                      >
                        Clear
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm">No IP addresses are currently rate limited.</div>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title="Clear this rate limit?"
        description={
          pending
            ? `${pending.ip} will be able to make ${pending.scopeLabel.toLowerCase()} again right away, instead of waiting until ${formatDateTimeInTimeZone(new Date(pending.expiresAt), timezone)}. This is recorded in the activity log.`
            : ''
        }
        confirmText="Clear rate limit"
        onConfirm={confirmClear}
        onCancel={() => setPending(null)}
      />
    </Section>
  );
}
