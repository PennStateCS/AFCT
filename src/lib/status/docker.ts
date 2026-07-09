import fs from 'fs';
import os from 'os';
import type { DockerStatusResponse } from '@/lib/status/types';

/** Best-effort container detection from /.dockerenv, cgroups, and env hints. */
export async function collectDocker(): Promise<DockerStatusResponse> {
  const indicators: string[] = [];
  let cgroupPaths: string[] = [];
  let containerId: string | undefined;
  const hostname = os.hostname();

  try {
    if (fs.existsSync('/.dockerenv')) indicators.push('/.dockerenv');
  } catch {}

  try {
    const raw = await fs.promises.readFile('/proc/1/cgroup', 'utf8');
    cgroupPaths = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (/docker|containerd|kubepods/i.test(raw)) indicators.push('/proc/1/cgroup');
    const m = raw.match(/([0-9a-f]{64})/);
    if (m) containerId = m[1];
  } catch {}

  if (process.env.DOCKER_CONTAINER === '1' || process.env.CONTAINER === '1') {
    indicators.push('CONTAINER env');
  }

  const envHostname = process.env.HOSTNAME;
  if (envHostname && envHostname !== hostname) indicators.push('HOSTNAME env');

  if (indicators.length === 0) return { docker: null };

  return {
    docker: {
      isDocker: true,
      containerId,
      containerIdShort: containerId ? containerId.slice(0, 12) : undefined,
      hostname,
      envHostname,
      indicators,
      cgroupPaths,
    },
  };
}
