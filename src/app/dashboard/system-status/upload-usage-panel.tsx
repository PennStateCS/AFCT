'use client';

import React from 'react';
import { FileWarning } from 'lucide-react';
import { formatBytes } from './status-format';
import { DonutLegend, StorageDonut, type DonutSlice } from './storage-donut';
import type { StorageUsage } from '@/lib/status/types';

/**
 * What the uploads volume holds.
 *
 * Two charts rather than one, because they answer different questions at wildly different
 * scales. Uploads are a small fraction of the disk they sit on, so a single pie of the disk
 * would draw every kind of file as an invisible sliver and say nothing about the thing this
 * section is about; a pie of the uploads alone would leave out the number that decides whether
 * any of it matters, which is how much room is left.
 */

/** The five theme-aware chart colours, cycled so a kind keeps its colour across renders. */
const SLICE_COLOURS = [
  'stroke-chart-1',
  'stroke-chart-2',
  'stroke-chart-3',
  'stroke-chart-4',
  'stroke-chart-5',
];

/** One headline number, with its unit spelled out underneath rather than in the number. */
const Figure = ({
  label,
  value,
  detail,
  tone = 'normal',
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'normal' | 'warning';
}) => (
  <div className="rounded border px-3 py-2">
    <div className="text-muted-foreground text-xs">{label}</div>
    <div
      className={`text-lg font-semibold tabular-nums ${tone === 'warning' ? 'text-destructive' : ''}`}
    >
      {value}
    </div>
    {detail && <div className="text-muted-foreground text-xs">{detail}</div>}
  </div>
);

export function UploadUsagePanel({ storage }: { storage: StorageUsage }) {
  const volume = storage.volume;
  const reclaimable = storage.categories.reduce((sum, c) => sum + c.abandonedBytes, 0);
  const reclaimableCount = storage.categories.reduce((sum, c) => sum + c.abandonedCount, 0);
  const uploadsTotal = storage.inUseBytes + reclaimable;

  // Largest first: the reason to read this is to find out what is taking the space.
  const held = [...storage.categories]
    .filter((c) => c.inUseCount > 0 || c.abandonedCount > 0 || c.error)
    .sort((a, b) => b.inUseBytes - a.inUseBytes);
  const emptyKinds = storage.categories.filter((c) => !held.includes(c));

  const kindSlices: Array<DonutSlice & { detail?: React.ReactNode }> = held.map((c, i) => ({
    key: c.category,
    label: c.label,
    bytes: c.inUseBytes,
    stroke: SLICE_COLOURS[i % SLICE_COLOURS.length]!,
    detail: `${formatBytes(c.inUseBytes)} · ${c.inUseCount.toLocaleString()} file${c.inUseCount === 1 ? '' : 's'}`,
  }));
  if (reclaimable > 0) {
    kindSlices.push({
      key: 'abandoned',
      label: 'Abandoned',
      bytes: reclaimable,
      stroke: 'stroke-destructive',
      detail: `${formatBytes(reclaimable)} · ${reclaimableCount.toLocaleString()} file${reclaimableCount === 1 ? '' : 's'}`,
    });
  }

  // Everything on the disk that is not uploads: the application images, the database, the
  // operating system. Named rather than left as an unexplained remainder, because somebody
  // looking at a full disk needs to know the uploads are not the whole story.
  const otherBytes = volume ? Math.max(0, volume.totalBytes - volume.freeBytes - uploadsTotal) : 0;
  const diskSlices: Array<DonutSlice & { detail?: React.ReactNode }> = volume
    ? [
        {
          key: 'uploads',
          label: 'Uploads',
          bytes: uploadsTotal,
          stroke: 'stroke-chart-1',
          detail: formatBytes(uploadsTotal),
        },
        {
          key: 'other',
          label: 'Everything else',
          bytes: otherBytes,
          stroke: 'stroke-chart-3',
          detail: formatBytes(otherBytes),
        },
        {
          key: 'free',
          label: 'Free',
          bytes: volume.freeBytes,
          stroke: 'stroke-chart-2',
          detail: formatBytes(volume.freeBytes),
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure
          label="In use"
          value={formatBytes(storage.inUseBytes)}
          detail={`${storage.inUseCount.toLocaleString()} file${storage.inUseCount === 1 ? '' : 's'}`}
        />
        <Figure
          label="Reclaimable"
          value={formatBytes(reclaimable)}
          detail={`${reclaimableCount.toLocaleString()} abandoned`}
        />
        <Figure
          label="Recorded but missing"
          value={storage.missingCount.toLocaleString()}
          detail={storage.missingCount > 0 ? 'needs attention' : 'none'}
          tone={storage.missingCount > 0 ? 'warning' : 'normal'}
        />
        <Figure
          label="Disk free"
          value={volume ? formatBytes(volume.freeBytes) : '—'}
          detail={volume ? `of ${formatBytes(volume.totalBytes)}` : 'not reported on this system'}
        />
      </div>

      {/* Wider than the text above it: two donuts with a legend each need the room, and
          squeezing them was what forced the labels to shorten. */}
      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        {volume && (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">The disk</h3>
            <div className="flex items-center gap-4">
              <StorageDonut
                slices={diskSlices}
                total={volume.totalBytes}
                centreValue={formatBytes(volume.freeBytes)}
                centreLabel="free"
              />
              <DonutLegend
                slices={diskSlices}
                total={volume.totalBytes}
                note="Uploads share this disk with the application images and the database."
              />
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Uploads by kind</h3>
          {uploadsTotal > 0 ? (
            <div className="flex items-center gap-4">
              <StorageDonut
                slices={kindSlices}
                total={uploadsTotal}
                centreValue={formatBytes(uploadsTotal)}
                centreLabel="uploaded"
              />
              <DonutLegend
                slices={kindSlices}
                total={uploadsTotal}
                note={
                  emptyKinds.length > 0
                    ? `Nothing stored for ${emptyKinds.map((c) => c.label.toLowerCase()).join(', ')}.`
                    : undefined
                }
              />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Nothing has been uploaded yet.</p>
          )}
        </section>
      </div>

      {held.some((c) => c.missingCount > 0 || c.error) && (
        <ul className="text-muted-foreground max-w-3xl space-y-1 text-xs">
          {held
            .filter((c) => c.missingCount > 0 || c.error)
            .map((c) => (
              <li key={c.category} className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium">{c.label}:</span>
                {c.missingCount > 0 && (
                  <span className="text-destructive inline-flex items-center gap-1">
                    <FileWarning className="size-3" aria-hidden />
                    {c.missingCount.toLocaleString()} recorded but missing
                  </span>
                )}
                {c.error && <span className="text-destructive">{c.error}</span>}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
