import fs from 'fs';
import os from 'os';
import type { DockerStatusResponse } from '@/lib/status/types';
import { currentVersion } from '@/lib/updates';

// Docker's default container hostname IS the short (12-hex) container ID, so when
// cgroup v2 (whose /proc/1/cgroup is just `0::/`) gives us nothing, the hostname is
// the next-best source for the ID.
const CONTAINER_ID_LIKE = /^[0-9a-f]{12,64}$/i;

// The cgroup v1 "unlimited" memory sentinel is a huge value near INT64 max, page
// aligned; anything at or above this is treated as no limit.
const CGROUP_V1_UNLIMITED = 0x7ffffffffffff000;

/** Which cgroup hierarchy this container runs under, by probing well-known paths. */
function detectCgroupVersion(): 'v1' | 'v2' | undefined {
  try {
    if (fs.existsSync('/sys/fs/cgroup/cgroup.controllers')) return 'v2';
    if (fs.existsSync('/sys/fs/cgroup/memory/memory.limit_in_bytes')) return 'v1';
  } catch {}
  return undefined;
}

/** Container memory cap in bytes; `null` when unlimited, `undefined` when unreadable. */
async function readMemoryLimit(cgv: 'v1' | 'v2' | undefined): Promise<number | null | undefined> {
  try {
    if (cgv === 'v2') {
      const raw = (await fs.promises.readFile('/sys/fs/cgroup/memory.max', 'utf8')).trim();
      if (raw === 'max') return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }
    const raw = (
      await fs.promises.readFile('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8')
    ).trim();
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return n >= CGROUP_V1_UNLIMITED ? null : n;
  } catch {
    return undefined;
  }
}

/** Container CPU cap in cores (quota/period); `null` unlimited, `undefined` unreadable. */
async function readCpuLimit(cgv: 'v1' | 'v2' | undefined): Promise<number | null | undefined> {
  try {
    if (cgv === 'v2') {
      const raw = (await fs.promises.readFile('/sys/fs/cgroup/cpu.max', 'utf8')).trim();
      const [quota, period] = raw.split(/\s+/);
      if (quota === 'max') return null;
      const q = Number(quota);
      const p = Number(period);
      return Number.isFinite(q) && p > 0 ? q / p : undefined;
    }
    const q = Number(
      (await fs.promises.readFile('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8')).trim(),
    );
    if (q === -1) return null;
    const p = Number(
      (await fs.promises.readFile('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8')).trim(),
    );
    return Number.isFinite(q) && q > 0 && p > 0 ? q / p : undefined;
  } catch {
    return undefined;
  }
}

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

  // cgroup v2 hosts don't expose the 64-hex id in /proc/1/cgroup, but Docker names the
  // container's hostname after its short id — fall back to that so the field isn't blank.
  if (!containerId) {
    const hostCandidate = envHostname ?? hostname;
    if (hostCandidate && CONTAINER_ID_LIKE.test(hostCandidate)) containerId = hostCandidate;
  }

  const cgroupVersion = detectCgroupVersion();
  const [memoryLimitBytes, cpuLimit] = await Promise.all([
    readMemoryLimit(cgroupVersion),
    readCpuLimit(cgroupVersion),
  ]);

  return {
    docker: {
      isDocker: true,
      containerId,
      containerIdShort: containerId ? containerId.slice(0, 12) : undefined,
      hostname,
      envHostname,
      indicators,
      cgroupPaths,
      imageTag: currentVersion(),
      cgroupVersion,
      memoryLimitBytes,
      cpuLimit,
    },
  };
}
