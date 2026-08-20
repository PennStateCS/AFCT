import fs from 'fs';
import path from 'path';
import { UPDATE_TRIGGER_DIR } from '@/lib/updates';
import { probeFailed } from './probe';
import type { HostBlock } from './types';

/**
 * What the server itself needs, as opposed to what AFCT needs.
 *
 * This process cannot see the host: it runs in the container that grades untrusted student
 * submissions, so it deliberately has no host mounts. The updater sidecar can, because it
 * already holds the Docker socket, and it writes what it finds into the same shared volume
 * the two already use to talk about upgrades. This reads that file and nothing else.
 *
 * Every failure here reports "cannot tell" rather than "nothing to do". An operator acting
 * on a false all-clear is worse than one who is told AFCT does not know.
 */

export const HOST_FACTS_FILE = path.join(UPDATE_TRIGGER_DIR, 'host.json');

/**
 * How old a report may be before it stops counting. The updater refreshes every five
 * minutes, so anything approaching an hour means it stopped, was replaced by a version
 * that does not write the file, or lost its mounts.
 */
export const HOST_FACTS_MAX_AGE_MS = 45 * 60 * 1000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const optionalCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

const optionalFlag = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

/** Parse a report, from anywhere. Exported so the tests can drive it without a filesystem. */
export function readHostFacts(raw: unknown, now: number): HostBlock {
  if (!isRecord(raw)) return { available: false, reason: 'no-report' };

  const checkedAt = typeof raw.checkedAt === 'string' ? raw.checkedAt : undefined;
  const stampedAt = checkedAt ? Date.parse(checkedAt) : Number.NaN;
  if (!Number.isFinite(stampedAt) || now - stampedAt > HOST_FACTS_MAX_AGE_MS) {
    return { available: false, reason: 'stale', checkedAt };
  }

  // The updater says so itself when it cannot recognise the host, which is the Windows
  // case and any Linux where the mounts did not land.
  if (raw.supported !== true) return { available: false, reason: 'unsupported', checkedAt };

  const packages = Array.isArray(raw.rebootPackages)
    ? raw.rebootPackages.filter((entry): entry is string => typeof entry === 'string')
    : [];

  return {
    available: true,
    checkedAt,
    osName: typeof raw.osName === 'string' && raw.osName ? raw.osName : undefined,
    rebootRequired: raw.rebootRequired === true,
    rebootPackages: packages,
    updatesAvailable: optionalCount(raw.updatesAvailable),
    securityUpdatesAvailable: optionalCount(raw.securityUpdatesAvailable),
    timeSynchronised: optionalFlag(raw.timeSynchronised),
  };
}

/** The current report, or why there is not one. */
export function collectHost(now: number = Date.now()): HostBlock {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(HOST_FACTS_FILE, 'utf8'));
  } catch (err) {
    // A missing file is the ordinary case on an install without the updater sidecar, so it
    // is not worth a log line; anything else is worth knowing about.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') probeFailed('host facts', err);
    return { available: false, reason: 'no-report' };
  }
  return readHostFacts(raw, now);
}
