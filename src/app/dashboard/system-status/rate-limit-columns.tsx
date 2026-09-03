'use client';

import React, { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { formatDateTimeInTimeZone } from '@/lib/date-format';
import { formatRelative } from './status-format';
import { copy } from './status-ui';
import type { IpDetails, RateLimitedAddress } from '@/lib/status/types';

/**
 * Lets a cell's text wrap instead of widening the table.
 *
 * The shared `TableCell` primitive sets `whitespace-nowrap`, which is right for the short
 * values most tables hold but pushes this one into a sideways scroll: several columns
 * carry a sentence. `whitespace-normal` overrides the inherited rule, and the width cap
 * is what actually gives the text somewhere to break.
 */
const Wrap = ({ children, width = 'max-w-[30ch]' }: { children: React.ReactNode; width?: string }) => (
  <div className={`${width} whitespace-normal`}>{children}</div>
);

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
  timeZone,
  hour12,
}: {
  details: IpDetails;
  timeZone: string;
  hour12: boolean;
}) => {
  const known = details.knownActivity;
  if (!known) {
    return <span className="text-muted-foreground">Not checked</span>;
  }
  if (known.eventCount === 0) {
    return (
      <span className="text-muted-foreground">Not seen in the last {known.windowDays} days</span>
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
          Last seen {formatDateTimeInTimeZone(new Date(known.lastSeen), timeZone, hour12)}
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

/**
 * The Clear button and its confirmation. State lives per row rather than in the tab, so
 * the table owns nothing beyond the rows themselves.
 */
const ClearCell = ({
  entry,
  timeZone,
  hour12,
  onClear,
  disabled,
}: {
  entry: RateLimitedAddress;
  timeZone: string;
  hour12: boolean;
  onClear: (entry: RateLimitedAddress) => void;
  disabled: boolean;
}) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setConfirming(true)}
        disabled={disabled}
        aria-label={`Clear the restriction on ${entry.ip}`}
      >
        Clear
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Clear this rate limit?"
        description={`${entry.ip} will be able to make ${entry.scopeLabel.toLowerCase()} again right away, instead of waiting until ${formatDateTimeInTimeZone(new Date(entry.expiresAt), timeZone, hour12)}. This is recorded in the activity log.`}
        confirmText="Clear rate limit"
        onConfirm={() => {
          setConfirming(false);
          onClear(entry);
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
};

/**
 * Columns for the System Status rate-limit table.
 *
 * `generatedAt` is the server's clock at the moment the list was taken. Every relative
 * time is measured against it rather than the browser's, so a client whose time is off
 * cannot render a live restriction as already expired.
 */
export function getRateLimitColumns({
  timeZone,
  hour12 = true,
  generatedAt,
  onClear,
  clearingIp,
}: {
  timeZone: string;
  hour12?: boolean;
  generatedAt: number;
  onClear: (entry: RateLimitedAddress) => void;
  clearingIp: string | null;
}): ColumnDef<RateLimitedAddress>[] {
  return [
    {
      accessorKey: 'ip',
      meta: { priority: 1 },
      header: 'IP address',
      cell: ({ row }) => {
        const entry = row.original;
        return (
          <div>
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
          </div>
        );
      },
    },
    {
      id: 'state',
      accessorFn: (row) => (row.state === 'blocked' ? 'Blocked' : 'Challenged'),
      meta: { priority: 1, filterVariant: 'multiselect', filterLabel: 'Status' },
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={row.original.state === 'blocked' ? 'danger' : 'warning'}>
          {row.original.state === 'blocked' ? 'Blocked' : 'Challenged'}
        </Badge>
      ),
    },
    {
      accessorKey: 'scopeLabel',
      meta: { priority: 2, filterVariant: 'multiselect', filterLabel: 'Limit' },
      header: 'Limit',
      cell: ({ row }) => <Wrap width="max-w-[16ch]">{row.original.scopeLabel}</Wrap>,
    },
    {
      accessorKey: 'reason',
      meta: { priority: 2 },
      header: 'Reason',
      cell: ({ row }) => <Wrap width="max-w-[28ch]">{row.original.reason}</Wrap>,
    },
    {
      id: 'seenBefore',
      // Sort by how many accounts have used the address: the strongest signal that a
      // restriction is catching a shared address rather than one person.
      accessorFn: (row) => row.details.knownActivity?.accountCount ?? -1,
      meta: { priority: 2 },
      header: 'Seen before',
      cell: ({ row }) => (
        <Wrap width="max-w-[24ch]">
          <SeenBefore details={row.original.details} timeZone={timeZone} hour12={hour12} />
        </Wrap>
      ),
    },
    {
      accessorKey: 'startedAt',
      meta: { priority: 3 },
      header: 'Restricted since',
      cell: ({ row }) => (
        <Wrap width="max-w-[14ch]">
          <div>{formatDateTimeInTimeZone(new Date(row.original.startedAt), timeZone, hour12)}</div>
          <div className="text-muted-foreground text-xs">
            {formatRelative(row.original.startedAt, generatedAt)}
          </div>
        </Wrap>
      ),
    },
    {
      accessorKey: 'attempts',
      meta: { priority: 3 },
      header: 'Recent activity',
      cell: ({ row }) => {
        const entry = row.original;
        return (
          <Wrap width="max-w-[22ch]">
            <div>
              {entry.attempts} attempt{entry.attempts === 1 ? '' : 's'} counted
              {entry.attemptsWhileRestricted > 0
                ? `, ${entry.attemptsWhileRestricted} turned away since`
                : ''}
            </div>
            <div className="text-muted-foreground text-xs">
              Last attempt {formatDateTimeInTimeZone(new Date(entry.lastAttemptAt), timeZone, hour12)}
            </div>
          </Wrap>
        );
      },
    },
    {
      accessorKey: 'expiresAt',
      meta: { priority: 1 },
      header: 'Expires',
      cell: ({ row }) => (
        <Wrap width="max-w-[14ch]">
          <div>{formatDateTimeInTimeZone(new Date(row.original.expiresAt), timeZone, hour12)}</div>
          <div className="text-muted-foreground text-xs">
            {formatRelative(row.original.expiresAt, generatedAt)}
          </div>
        </Wrap>
      ),
    },
    {
      id: 'actions',
      // Clear is a text button, not an overflow menu, so it keeps the card's footer row.
      meta: { priority: 1, mobileActionPlacement: 'footer' },
      header: '',
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <ClearCell
          entry={row.original}
          timeZone={timeZone}
          hour12={hour12}
          onClear={onClear}
          disabled={clearingIp !== null}
        />
      ),
    },
  ];
}
