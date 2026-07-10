'use client';

import React, { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import pkg from '../../../../../package.json';
import type { ServerStatusResponse, IpAddr } from '@/lib/status/types';
import {
  Loading,
  Stat,
  Meter,
  Section,
  Sparkline,
  useStatusQuery,
  readHistory,
  formatBytes,
  formatUptime,
  toTitleCase,
  copy,
} from '../status-ui';

export default function ServerTab({
  active,
  autoRefresh,
  windowHours,
}: {
  active: boolean;
  autoRefresh: boolean;
  windowHours: number;
}) {
  const { data, isLoading } = useStatusQuery<ServerStatusResponse>({
    queryKey: queryKeys.admin.statusServer(),
    path: apiPaths.admin.statusServer(),
    active,
    autoRefresh,
  });

  const system = data?.system;
  const software = data?.software;
  const s = system?.stats;

  // Sparklines are read from the shared trend history the summary card persists.
  const sparklines = useMemo(() => {
    const now = Date.now();
    const hist = readHistory().filter((p) => now - p.ts <= windowHours * 3600_000);
    return {
      cpu: hist.map((p) => p.cpuPct ?? 0),
      mem: hist.map((p) => p.memPct ?? 0),
      latency: hist.map((p) => p.latencyMs ?? 0),
    };
  }, [windowHours]);

  if (isLoading || !system) {
    return <Loading />;
  }

  return (
    <div className="max-w-xl space-y-8">
      <Section title="Performance">
        <div className="space-y-2">
          <Stat
            label="Arch / CPUs"
            value={`${system.arch ?? '—'} / ${system.cpuCount ?? system.cpus?.length ?? '—'}`}
          />
          <Stat label="Uptime" value={formatUptime(system.uptime)} />
          <Stat
            label="Memory"
            value={
              system.memory
                ? `${formatBytes(system.memory.total)} total — ${formatBytes(system.memory.free)} free`
                : '—'
            }
          />
          <Stat
            label="Disk IO"
            value={
              s?.diskIo
                ? `${formatBytes(s.diskIo.readBytesPerSec)}/s read — ${formatBytes(s.diskIo.writeBytesPerSec)}/s write`
                : '—'
            }
          />
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">CPU (process)</span>
              <span>{Math.round(s?.cpuProcessPct ?? 0)}%</span>
            </div>
            <Meter pct={s?.cpuProcessPct} label="CPU process usage" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Memory (process / system)</span>
              <span>{(s?.memProcessPctOfSystem ?? 0).toFixed(1)}%</span>
            </div>
            <Meter pct={s?.memProcessPctOfSystem} label="Process memory usage" />
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-2 rounded border p-3">
            <div className="text-muted-foreground text-xs font-semibold">
              CPU % (last {windowHours}h)
            </div>
            <Sparkline points={sparklines.cpu} />
          </div>
          <div className="space-y-2 rounded border p-3">
            <div className="text-muted-foreground text-xs font-semibold">
              Mem % (last {windowHours}h)
            </div>
            <Sparkline points={sparklines.mem} />
          </div>
          <div className="space-y-2 rounded border p-3">
            <div className="text-muted-foreground text-xs font-semibold">
              Latency (ms) (last {windowHours}h)
            </div>
            <Sparkline points={sparklines.latency} />
          </div>
        </div>
      </Section>

      <Section title="Software">
        <div className="space-y-2">
          <Stat label="AFCT Dashboard" value={pkg.version} />
          <Stat label="Deployment Environment" value={toTitleCase(software?.deployEnv)} />
          <Stat label="Next.js" value={software?.nextVersion ?? '—'} />
          <Stat
            label="OS / Arch"
            value={`${system.platform ?? '—'}${system.release ? ` ${system.release}` : ''} / ${system.arch ?? '—'}`}
          />
          <Stat label="AFCT Evaluator" value={software?.evaluatorVersion ?? '—'} />
          <Stat label="Node" value={software?.nodeVersion ?? '—'} />
          <Stat label="Java" value={software?.javaVersion ?? '—'} />
          {software?.buildHash && <Stat label="Build" value={software.buildHash} />}
          {software?.imageTag && <Stat label="Image" value={software.imageTag} />}
        </div>
      </Section>

      <Section title="Network Interfaces">
        <Stat label="Hostname" value={system.hostname ?? '—'} />
        {(system.ipAddresses?.length ?? 0) > 0 ? (
          <ul className="divide-y rounded border">
            {(system.ipAddresses as IpAddr[]).map((ip, i) => (
              <li key={i} className="flex items-center justify-between gap-3 p-2">
                <div className="text-sm">
                  <span>{ip.iface ?? 'eth'}</span>: <span>{ip.address}</span>{' '}
                  <span className="text-muted-foreground">{ip.family ? `(${ip.family})` : ''}</span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => copy(ip.address)}
                  aria-label={`Copy IP address ${ip.address ?? ''}`}
                >
                  Copy
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm">—</div>
        )}
      </Section>
    </div>
  );
}
