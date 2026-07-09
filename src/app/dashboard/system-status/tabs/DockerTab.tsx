'use client';

import React from 'react';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import type { DockerStatusResponse } from '@/lib/status/types';
import { Skel, Stat, Section, useStatusQuery, copy } from '../status-ui';

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
    return <Skel w="w-40" />;
  }

  const docker = data.docker;

  if (!docker) {
    return (
      <Section title="Docker">
        <div className="text-sm">Not running inside a container.</div>
      </Section>
    );
  }

  return (
    <Section title="Docker">
      <Stat
        label="Container ID"
        value={docker.containerIdShort ?? docker.containerId ?? '—'}
        onCopy={docker.containerId ? () => copy(docker.containerId) : undefined}
      />
      <Stat label="Hostname" value={docker.envHostname ?? docker.hostname ?? '—'} />
      <Stat
        label="Indicators"
        value={docker.indicators?.length ? docker.indicators.join(', ') : '—'}
      />
      <div>
        <div className="text-muted-foreground mb-1 text-sm">Cgroup</div>
        {docker.cgroupPaths?.length ? (
          <ul className="divide-y rounded border">
            {docker.cgroupPaths.slice(0, 6).map((line, i) => (
              <li key={i} className="px-2 py-1 text-xs break-all">
                {line}
              </li>
            ))}
            {docker.cgroupPaths.length > 6 ? (
              <li className="text-muted-foreground px-2 py-1 text-xs">
                +{docker.cgroupPaths.length - 6} more
              </li>
            ) : null}
          </ul>
        ) : (
          <div className="text-sm">—</div>
        )}
      </div>
    </Section>
  );
}
