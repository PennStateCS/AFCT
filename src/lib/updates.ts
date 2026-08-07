import fs from 'fs';
import path from 'path';

// The volume shared with the `updater` sidecar. The app can only REQUEST an
// upgrade by dropping a validated request file here; it reads the sidecar's
// progress from the status file. The app never talks to Docker itself.
export const UPDATE_TRIGGER_DIR = process.env.UPDATE_TRIGGER_DIR || '/update-triggers';
export const UPDATE_REQUEST_FILE = path.join(UPDATE_TRIGGER_DIR, 'request.json');
export const UPDATE_STATUS_FILE = path.join(UPDATE_TRIGGER_DIR, 'status.json');
// The version -> pre-upgrade-backup map the updater records; drives downgrade.
export const UPDATE_RESTORE_POINTS_FILE = path.join(UPDATE_TRIGGER_DIR, 'restore-points.json');
// The updater's append-only live log for the current upgrade (image pull + recreate
// output plus heartbeats). The app tails this to stream real-time progress to the UI.
export const UPDATE_PROGRESS_FILE = path.join(UPDATE_TRIGGER_DIR, 'progress.log');
// The updater stamps its own running version here; drives the "update service is
// behind" prompt (the updater tracks the app tag but recreates itself separately).
export const UPDATE_UPDATER_VERSION_FILE = path.join(UPDATE_TRIGGER_DIR, 'updater.version');
// The updater sidecar stamps this (an epoch) every few seconds while it runs. The
// app has no Docker access, so a fresh file here is how it knows the sidecar is
// actually installed and running.
export const UPDATE_PRESENCE_FILE = path.join(UPDATE_TRIGGER_DIR, 'updater.alive');
// Whether the running updater can still see the env and compose files it has to rewrite.
// A container keeps the paths it started with, so a compose change that moves them leaves
// an updater that is the right VERSION but cannot perform an upgrade. It reported itself
// "up to date" while every upgrade failed; this is how the app can tell the difference.
export const UPDATE_UPDATER_READINESS_FILE = path.join(
  UPDATE_TRIGGER_DIR,
  'updater.readiness.json',
);
// Generous vs the updater's ~5s beat: tolerates a busy loop / long upgrade without
// falsely reporting the sidecar as gone.
const UPDATER_PRESENCE_MAX_AGE_MS = 180_000;

// The curated release manifest: the list of versions an admin may upgrade to.
// Fetched from the repo by default so it isn't frozen to the running image's own
// build; override for a pinned or mirrored deployment.
export const UPDATE_MANIFEST_URL =
  process.env.UPDATE_MANIFEST_URL ||
  'https://raw.githubusercontent.com/PennStateCS/AFCT/main/deploy/versions.json';

// Same tag rule the updater sidecar enforces: letters, digits, and . _ - only,
// not leading with a separator. Keep the two in sync.
const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isValidTag(tag: string): boolean {
  return typeof tag === 'string' && TAG_RE.test(tag);
}

// A restore point is a backup timestamp (YYYYMMDD-HHMMSS), matching backup.sh.
const RESTORE_POINT_RE = /^[0-9]{8}-[0-9]{6}$/;
export function isValidRestorePoint(ts: string): boolean {
  return typeof ts === 'string' && RESTORE_POINT_RE.test(ts);
}

export type ReleaseVersion = {
  tag: string;
  label?: string;
  notes?: string;
  releasedAt?: string;
  // Set when an in-app upgrade alone isn't enough for this release — the updater
  // sidecar or the compose file changed, and the app can't apply those to itself.
  // The admin must run the installer on the host afterward to finish.
  requiresHostUpdate?: boolean;
  // An optional free-text note for this specific release, shown in the Updates tab
  // when the version is selected. Set from an annotated tag's message at release time
  // (see .github/workflows/release.yml) for the rare release that needs the admin to
  // do something on the server first. Absent on ordinary releases.
  upgradeNote?: string;
};

export type ReleaseManifest = { versions: ReleaseVersion[] };

// A recorded pre-upgrade snapshot: the version that was running and the backup taken
// before it was replaced. Downgrading restores this backup and runs that version.
export type RestorePoint = {
  version: string;
  backup: string;
  createdAt?: string;
  // File details, filled in by matching the backup against the files on disk (see
  // withBackupDetails). Undefined when the backup file is gone or can't be read.
  size?: number | null;
  encrypted?: boolean;
};

export type UpdateStatus = {
  requestId?: string;
  phase?: string;
  message?: string;
  fromTag?: string;
  toTag?: string;
  updatedAt?: string;
};

// The deployed application version, from the tag the Compose file passes in as
// IMAGE_TAG (see deploy/docker-compose.yml). Falls back to `main`.
export function currentVersion(): string {
  return process.env.IMAGE_TAG || process.env.AFCT_APP_TAG || 'main';
}

// Fetch and sanitize the curated manifest. Only well-formed, valid-tag entries are
// returned; a malformed manifest yields an empty list rather than throwing.
export async function fetchManifest(): Promise<ReleaseManifest> {
  const res = await fetch(UPDATE_MANIFEST_URL, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`manifest fetch failed with status ${res.status}`);
  }
  const data = (await res.json()) as Partial<ReleaseManifest>;
  const versions = Array.isArray(data?.versions)
    ? data.versions.filter((v): v is ReleaseVersion => !!v && isValidTag(v.tag))
    : [];
  return { versions };
}

// Whether the privileged updater sidecar is installed and running. False when its
// heartbeat is missing or stale (sidecar disabled, not deployed, or stopped), in
// which case in-app upgrades/downgrades can't be performed.
export function updaterAvailable(): boolean {
  try {
    return Date.now() - fs.statSync(UPDATE_PRESENCE_FILE).mtimeMs < UPDATER_PRESENCE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

// The updater's most recent progress, or null if nothing has run / the volume
// isn't mounted (e.g. local dev).
export function readStatus(): UpdateStatus | null {
  try {
    return JSON.parse(fs.readFileSync(UPDATE_STATUS_FILE, 'utf8')) as UpdateStatus;
  } catch {
    return null;
  }
}

/** A slice of the live progress log: new lines past a cursor, and the cursor to
 *  send next. `since` is a line count (not a byte offset), so a truncate/rotate of
 *  the log resets cleanly (fewer lines than `since` -> start over from the top). */
/**
 * `reset` means these lines REPLACE whatever the reader already has rather than being
 * appended to it: the log got shorter than the cursor, so a new run truncated it and this
 * slice starts from the top. Without that signal a reader appends, and the previous run's
 * output stays on screen above the new run's - which is what the Updates tab did when an
 * upgrade was started while a self-update was still showing.
 */
export type ProgressSlice = { lines: string[]; nextCursor: number; reset: boolean };

/** Pure splitter, extracted so it can be unit-tested without the filesystem. */
export function sliceProgress(content: string, since: number): ProgressSlice {
  const all = content.split('\n');
  // A trailing newline yields a final empty element; drop it so it isn't a "line".
  if (all.length > 0 && all[all.length - 1] === '') all.pop();
  // The file was truncated/rotated (now shorter than the cursor): resend from 0.
  const truncated = !(since >= 0 && since <= all.length);
  const from = truncated ? 0 : since;
  return { lines: all.slice(from), nextCursor: all.length, reset: truncated };
}

/** New progress-log lines past `since`, or an empty slice if the log isn't there. */
export function readProgress(since = 0): ProgressSlice {
  try {
    return sliceProgress(fs.readFileSync(UPDATE_PROGRESS_FILE, 'utf8'), since);
  } catch {
    return { lines: [], nextCursor: since, reset: false };
  }
}

// Empty the live progress log at the moment a new run is requested. The updater
// truncates it too, but only once it claims the request; the UI opens the progress
// stream the instant the request POST returns, so without this the stream replays the
// PREVIOUS run's lines (e.g. a just-finished self-update) until the updater catches up.
// Called by the request writers below so every streamed action starts from a clean log.
// Best-effort: if it fails, the updater's own reset still clears the log for its run.
export function resetProgress(): void {
  try {
    fs.mkdirSync(UPDATE_TRIGGER_DIR, { recursive: true });
    fs.writeFileSync(UPDATE_PROGRESS_FILE, '');
  } catch {
    // best-effort; the updater resets the log again when it starts the run
  }
}

// Drop a validated upgrade request for the sidecar. Written to a temp file and
// renamed so the sidecar never reads a half-written request. Throws if the
// trigger volume isn't mounted (surfaced by the caller as "service unavailable").
export function writeUpdateRequest(request: {
  tag: string;
  requestedBy: string;
  requestId: string;
  backupFirst?: boolean;
}): void {
  fs.mkdirSync(UPDATE_TRIGGER_DIR, { recursive: true });
  resetProgress();
  const payload = {
    action: 'upgrade',
    tag: request.tag,
    requestedBy: request.requestedBy,
    requestId: request.requestId,
    backupFirst: request.backupFirst !== false,
  };
  const tmp = path.join(UPDATE_TRIGGER_DIR, `.request.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, UPDATE_REQUEST_FILE);
}

// Records the requestId of the last update run whose terminal outcome the app has
// already written to the activity log, so a completed run is logged exactly once no
// matter how many admins poll the status. Lives in the trigger volume next to
// status.json; the app owns it (the updater never touches it).
export const UPDATE_STATUS_LOGGED_FILE = path.join(UPDATE_TRIGGER_DIR, 'status.logged');

// The requestId already logged, or '' if none (missing file / unmounted volume).
export function readLoggedStatusRequestId(): string {
  try {
    return fs.readFileSync(UPDATE_STATUS_LOGGED_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

// Remember that this run's outcome has been logged. Best-effort: a failed write just
// means the outcome could be logged again on a later poll.
export function markStatusLogged(requestId: string): void {
  try {
    fs.mkdirSync(UPDATE_TRIGGER_DIR, { recursive: true });
    fs.writeFileSync(UPDATE_STATUS_LOGGED_FILE, requestId);
  } catch {
    // best-effort
  }
}

// The last `maxLines` lines of the live progress log, for attaching a snapshot of a
// finished run to its outcome log entry. Empty if the log isn't present.
export function readProgressTail(maxLines: number): string[] {
  const { lines } = readProgress(0);
  return lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines;
}

// The updater stamps its own running version (its image's version label) here on
// startup. The app compares it to the current app tag to tell when the updater is
// behind (it tracks the same tag but is recreated on its own), so it can offer a
// self-update. Empty string if the updater hasn't stamped it (older updater / dev).
export function updaterVersion(): string {
  try {
    return fs.readFileSync(UPDATE_UPDATER_VERSION_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

/** What the updater reports about its own configuration. Paths only, never contents. */
export type UpdaterReadiness = {
  envFile: string;
  composeFile: string;
  envFileOk: boolean;
  composeFileOk: boolean;
};

/**
 * The updater's self-report, or null when it hasn't written one.
 *
 * Null is NOT "broken": an updater older than this file simply never stamps it, and that
 * is the common case right after upgrading. Treat null as unknown and say nothing, so a
 * healthy old install isn't nagged about a problem it may not have.
 */
export function updaterReadiness(): UpdaterReadiness | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(UPDATE_UPDATER_READINESS_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.envFileOk !== 'boolean' || typeof r.composeFileOk !== 'boolean') return null;
    return {
      envFile: typeof r.envFile === 'string' ? r.envFile : '',
      composeFile: typeof r.composeFile === 'string' ? r.composeFile : '',
      envFileOk: r.envFileOk,
      composeFileOk: r.composeFileOk,
    };
  } catch {
    return null;
  }
}

// Drop a validated SELF-UPDATE request: recreate the updater sidecar itself at `tag`.
// The updater pulls its new image and hands off to a detached helper to swap the
// container. Atomic write, like the other requests.
export function writeSelfUpdateRequest(request: {
  tag: string;
  requestedBy: string;
  requestId: string;
}): void {
  fs.mkdirSync(UPDATE_TRIGGER_DIR, { recursive: true });
  resetProgress();
  const payload = {
    action: 'self-update',
    tag: request.tag,
    requestedBy: request.requestedBy,
    requestId: request.requestId,
  };
  const tmp = path.join(UPDATE_TRIGGER_DIR, `.request.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, UPDATE_REQUEST_FILE);
}

// Restore points recorded by the updater (newest first). Only well-formed entries
// are returned; missing file / unmounted volume yields an empty list.
export function readRestorePoints(): RestorePoint[] {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(UPDATE_RESTORE_POINTS_FILE, 'utf8'));
    if (!Array.isArray(data)) return [];
    return (data as RestorePoint[])
      .filter((r) => !!r && isValidTag(r.version) && isValidRestorePoint(r.backup))
      .sort((a, b) => b.backup.localeCompare(a.backup));
  } catch {
    return [];
  }
}

// Fill in each restore point's backup file details (size, encrypted) by matching its
// backup timestamp against the backup files currently on disk. Kept pure (files passed
// in) so it doesn't couple this module to the backups reader and stays unit-testable. A
// point whose backup file is missing keeps undefined details, shown as unknown.
export function withBackupDetails(
  points: RestorePoint[],
  files: { timestamp: string; size: number | null; encrypted: boolean }[],
): RestorePoint[] {
  const byTimestamp = new Map(files.map((f) => [f.timestamp, f]));
  return points.map((p) => {
    const file = byTimestamp.get(p.backup);
    return file ? { ...p, size: file.size, encrypted: file.encrypted } : p;
  });
}

// Drop a validated DELETE-RESTORE-POINT request: the sidecar removes the restore point
// from the map and deletes its backup file(s) to reclaim disk. Not destructive to the
// running app. Atomic write, like the other requests.
export function writeDeleteRestorePointRequest(request: {
  restorePoint: string;
  requestedBy: string;
  requestId: string;
}): void {
  fs.mkdirSync(UPDATE_TRIGGER_DIR, { recursive: true });
  const payload = {
    action: 'delete-restore-point',
    restorePoint: request.restorePoint,
    requestedBy: request.requestedBy,
    requestId: request.requestId,
  };
  const tmp = path.join(UPDATE_TRIGGER_DIR, `.request.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, UPDATE_REQUEST_FILE);
}

// Drop a validated DOWNGRADE request for the sidecar (destructive: it restores the
// backup, discarding everything since). Atomic write, like the upgrade request.
export function writeDowngradeRequest(request: {
  tag: string;
  restorePoint: string;
  requestedBy: string;
  requestId: string;
  // When true, the updater proceeds even if it can't confirm a pre-downgrade safety
  // backup of the current state (it otherwise refuses, to avoid unrecoverable loss).
  // An explicit admin override, only sent after the updater has refused for that reason.
  force?: boolean;
}): void {
  fs.mkdirSync(UPDATE_TRIGGER_DIR, { recursive: true });
  resetProgress();
  const payload = {
    action: 'downgrade',
    tag: request.tag,
    restorePoint: request.restorePoint,
    requestedBy: request.requestedBy,
    requestId: request.requestId,
    // Only include the flag when set, so an ordinary downgrade keeps the smaller payload
    // and the updater applies its safe default (force=false).
    ...(request.force ? { force: true } : {}),
  };
  const tmp = path.join(UPDATE_TRIGGER_DIR, `.request.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, UPDATE_REQUEST_FILE);
}
