'use client';

import React from 'react';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import type { DockerStatusResponse } from '@/lib/status/types';
import { Loading, Stat, StatGrid, StatusSection, useStatusQuery, copy } from '../status-ui';
import { formatBytes } from '../status-format';

// The resource-limit fields are tri-state: a number is the cap, `null` means the
// container has no limit, and `undefined` means it couldn't be read from cgroup.
const formatMemoryLimit = (bytes?: number | null) =>
  bytes === undefined ? '—' : bytes === null ? 'No limit' : formatBytes(bytes);

const formatCpuLimit = (cores?: number | null) => {
  if (cores === undefined) return '—';
  if (cores === null) return 'No limit';
  const value = Number.isInteger(cores) ? String(cores) : cores.toFixed(2);
  return `${value} ${cores === 1 ? 'core' : 'cores'}`;
};

export default function DockerTab({
  active,
  autoRefresh,
}: {
  active: boolean;
  autoRefresh: boolean;
}) {
  const { data, isLoading } = useStatusQuery<DockerStatusResponse>({
    queryKey: queryKeys.admin.statusDocker(),
    path: apiPaths.admin.statusDocker(),
    active,
    autoRefresh,
  });

  if (isLoading || !data) {
    return <Loading />;
  }

  const docker = data.docker;

  if (!docker) {
    return (
      <StatusSection title="Container">
        <div className="text-muted-foreground text-sm">Not running inside a container.</div>
      </StatusSection>
    );
  }

  return (
    <div className="space-y-5">
      {/* Seven short attributes, paired up so they do not run down the page. The card takes
          the same width as every other section on every other tab: `StatGrid` already keeps
          each reading beside its label, so the panel does not need to be narrow as well, and
          two stacked cards at two different widths read as an accident. */}
      <StatusSection title="Container">
        <StatGrid>
          <Stat
            label="Container ID"
            value={docker.containerIdShort ?? docker.containerId ?? '—'}
            onCopy={docker.containerId ? () => copy(docker.containerId) : undefined}
          />
          <Stat label="Hostname" value={docker.envHostname ?? docker.hostname ?? '—'} />
          <Stat label="Running version" value={docker.imageTag ?? '—'} />
          <Stat label="Memory limit" value={formatMemoryLimit(docker.memoryLimitBytes)} />
          <Stat label="CPU limit" value={formatCpuLimit(docker.cpuLimit)} />
          <Stat label="cgroup version" value={docker.cgroupVersion ?? '—'} />
          <Stat
            label="Indicators"
            value={docker.indicators?.length ? docker.indicators.join(', ') : '—'}
          />
        </StatGrid>
      </StatusSection>

      {/* Its own section, and a wider one: cgroup paths are long, break mid-word, and are
          read character by character when something is wrong, so they get the room the
          summary above deliberately refuses. */}
      <StatusSection title="Cgroup">
        {docker.cgroupPaths?.length ? (
          <ul className="bg-muted divide-y rounded-md border">
            {docker.cgroupPaths.slice(0, 6).map((line, i) => (
              <li key={i} className="px-3 py-1.5 font-mono text-xs break-all">
                {line}
              </li>
            ))}
            {docker.cgroupPaths.length > 6 ? (
              <li className="text-muted-foreground px-3 py-1.5 text-xs">
                +{docker.cgroupPaths.length - 6} more
              </li>
            ) : null}
          </ul>
        ) : (
          <div className="text-muted-foreground text-sm">—</div>
        )}
      </StatusSection>
    </div>
  );
}
