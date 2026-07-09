import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { cached, STATUS_TTL } from '@/lib/status/cache';
import type { ServerStatusResponse, SystemBlock, SoftwareBlock } from '@/lib/status/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type DiskIoSample = { device: string; readSectors: number; writeSectors: number };

const normalizeBlockDevice = (devPath: string) => {
  const name = devPath.replace('/dev/', '');
  if (/^nvme\d+n\d+p\d+$/i.test(name)) return name.replace(/p\d+$/i, '');
  if (/^mmcblk\d+p\d+$/i.test(name)) return name.replace(/p\d+$/i, '');
  return name.replace(/\d+$/i, '');
};

const readDiskStatsSample = async (): Promise<DiskIoSample | null> => {
  if (!fs.existsSync('/proc/diskstats')) return null;
  let rootDev: string | null = null;
  try {
    const mounts = await fs.promises.readFile('/proc/mounts', 'utf8');
    const rootLine = mounts
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && l.split(' ')[1] === '/');
    const dev = rootLine?.split(' ')[0] ?? null;
    if (dev && dev.startsWith('/dev/')) rootDev = normalizeBlockDevice(dev);
  } catch {}

  try {
    const raw = await fs.promises.readFile('/proc/diskstats', 'utf8');
    const stats: Record<string, { readSectors: number; writeSectors: number }> = {};
    raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line) => {
        const cols = line.split(/\s+/);
        if (cols.length < 14) return;
        const name = cols[2];
        const readSectors = Number(cols[5] ?? 0);
        const writeSectors = Number(cols[9] ?? 0);
        if (!Number.isFinite(readSectors) || !Number.isFinite(writeSectors)) return;
        stats[name] = { readSectors, writeSectors };
      });

    if (rootDev && stats[rootDev]) return { device: rootDev, ...stats[rootDev] };

    const candidates = Object.keys(stats).filter(
      (n) => !/^loop\d+$/i.test(n) && !/^ram\d+$/i.test(n),
    );
    const preferred = candidates.find(
      (n) =>
        /^(sd|vd|xvd)[a-z]/i.test(n) ||
        /^nvme\d+n\d+/i.test(n) ||
        /^mmcblk\d+/i.test(n) ||
        /^dm-\d+/i.test(n),
    );
    const pick = preferred ?? candidates[0];
    return pick ? { device: pick, ...stats[pick] } : null;
  } catch {
    return null;
  }
};

/** Host + process metrics, including a ~100ms CPU/disk-IO sample. */
export async function collectSystem(): Promise<SystemBlock> {
  const os = await import('os');

  const cores = os.cpus()?.length ?? 1;
  const cpu0 = process.cpuUsage();
  const time0 = process.hrtime.bigint();
  const disk0 = await readDiskStatsSample();
  await sleep(100);
  const cpu1 = process.cpuUsage(cpu0);
  const time1 = process.hrtime.bigint();
  const disk1 = await readDiskStatsSample();
  const elapsedMicros = Number((time1 - time0) / 1000n);
  const procCpuMicros = cpu1.user + cpu1.system;
  const cpuPct =
    elapsedMicros > 0 ? Math.min(100, (procCpuMicros / elapsedMicros) * (100 / cores)) : 0;

  const diskIo = (() => {
    if (!disk0 || !disk1 || disk0.device !== disk1.device) return undefined;
    const elapsedSec = elapsedMicros / 1_000_000;
    if (!Number.isFinite(elapsedSec) || elapsedSec <= 0) return undefined;
    const readDelta = disk1.readSectors - disk0.readSectors;
    const writeDelta = disk1.writeSectors - disk0.writeSectors;
    if (readDelta < 0 || writeDelta < 0) return undefined;
    const sectorBytes = 512;
    return {
      device: disk1.device,
      readBytesPerSec: (readDelta * sectorBytes) / elapsedSec,
      writeBytesPerSec: (writeDelta * sectorBytes) / elapsedSec,
    };
  })();

  return {
    ok: true,
    uptime: os.uptime(),
    processUptime: process.uptime(),
    nodeVersion: process.version,
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuCount: cores,
    cpus:
      os
        .cpus()
        ?.slice(0, 4)
        .map((c) => ({ model: c.model, speed: c.speed })) ?? [],
    memory: { total: os.totalmem(), free: os.freemem() },
    loadavg: os.loadavg(),
    ipAddresses: (() => {
      try {
        const netifs = os.networkInterfaces();
        const out: Array<{ iface: string; address: string; family: string }> = [];
        const skipIfName = /^(docker|veth|br-|virbr|vmnet|vboxnet|lo|loopback)$/i;
        for (const [name, addrs] of Object.entries(netifs)) {
          if (!addrs || skipIfName.test(name)) continue;
          for (const a of addrs) {
            const addr = a as { address?: string; family?: string | number; internal?: boolean };
            if (!addr || addr.internal) continue;
            const address = addr.address ?? '';
            if (!address || address === '::1') continue;
            if (/^fe80:/i.test(address)) continue;
            if (/^f[cd]/i.test(address)) continue;
            if (/^169\.254\./.test(address)) continue;
            out.push({ iface: name, address, family: String(addr.family ?? '') });
          }
        }
        const seen = new Set<string>();
        return out.filter((i) => (seen.has(i.address) ? false : (seen.add(i.address), true)));
      } catch {
        return [];
      }
    })(),
    stats: {
      pid: process.pid,
      cwd: process.cwd(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      memProcess: { ...process.memoryUsage() },
      memProcessPctOfSystem: (() => {
        const rss = process.memoryUsage().rss ?? 0;
        const total = os.totalmem() || 1;
        return Number(((rss / total) * 100).toFixed(2));
      })(),
      cpuProcessPct: Number(cpuPct.toFixed(2)),
      diskIo,
      uptimeBreakdown: (() => {
        const secs = Math.floor(process.uptime());
        return {
          days: Math.floor(secs / 86400),
          hours: Math.floor((secs % 86400) / 3600),
          minutes: Math.floor((secs % 3600) / 60),
          seconds: secs % 60,
        };
      })(),
    },
  };
}

/** External tool versions — cached, since a `java -version` exec is slow and static. */
async function detectJavaVersion(): Promise<string | undefined> {
  try {
    const out = execSync('java -version 2>&1', {
      encoding: 'utf-8',
      stdio: 'pipe',
      shell: process.env.SHELL ?? (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'),
    }) as string;
    return out.match(/version\s+"(.+?)"/i)?.[1];
  } catch {
    return undefined;
  }
}

async function detectEvaluatorVersion(): Promise<string | undefined> {
  try {
    const evaluatorPath = path.join(process.cwd(), 'jars', 'afct-evaluator.jar');
    const raw = execSync(`java -jar "${evaluatorPath}" -v -j`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    }) as string;
    return (JSON.parse(raw.trim()) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

/** Version + build metadata. Tool versions are TTL-cached to avoid per-poll execs. */
export async function collectSoftware(): Promise<SoftwareBlock> {
  const [javaVersion, evaluatorVersion] = await Promise.all([
    cached('java-version', STATUS_TTL.versions, detectJavaVersion),
    cached('evaluator-version', STATUS_TTL.versions, detectEvaluatorVersion),
  ]);

  let nextVersion: string | undefined;
  try {
    const pkg = (await import('../../../package.json')).default as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    nextVersion = pkg.dependencies?.next ?? pkg.devDependencies?.next;
  } catch {}

  return {
    nodeVersion: process.version,
    nextVersion,
    javaVersion,
    evaluatorVersion,
    deployEnv:
      process.env.VERCEL_ENV ??
      process.env.APP_ENV ??
      process.env.ENVIRONMENT ??
      process.env.NODE_ENV ??
      undefined,
    buildHash:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GIT_COMMIT ??
      process.env.COMMIT_SHA ??
      process.env.SOURCE_VERSION ??
      process.env.GITHUB_SHA ??
      process.env.RENDER_GIT_COMMIT ??
      undefined,
    imageTag:
      process.env.IMAGE_TAG ??
      process.env.DOCKER_IMAGE_TAG ??
      process.env.CONTAINER_IMAGE_TAG ??
      process.env.IMAGE_VERSION ??
      process.env.GIT_TAG ??
      process.env.VERCEL_GIT_COMMIT_REF ??
      undefined,
  };
}

export async function collectServer(): Promise<ServerStatusResponse> {
  const [system, software] = await Promise.all([collectSystem(), collectSoftware()]);
  return { system, software };
}
