import fs from 'fs';
import path from 'path';

// The volume shared with the `updater` sidecar. The app can only REQUEST an
// upgrade by dropping a validated request file here; it reads the sidecar's
// progress from the status file. The app never talks to Docker itself.
export const UPDATE_TRIGGER_DIR = process.env.UPDATE_TRIGGER_DIR || '/update-triggers';
export const UPDATE_REQUEST_FILE = path.join(UPDATE_TRIGGER_DIR, 'request.json');
export const UPDATE_STATUS_FILE = path.join(UPDATE_TRIGGER_DIR, 'status.json');

// The curated release manifest: the list of versions an admin may upgrade to.
// Fetched from the repo by default so it isn't frozen to the running image's own
// build; override for a pinned or mirrored deployment.
export const UPDATE_MANIFEST_URL =
  process.env.UPDATE_MANIFEST_URL ||
  'https://raw.githubusercontent.com/PennStateWilkes-Barre/AFCT-Dashboard/main/deploy/versions.json';

// Same tag rule the updater sidecar enforces: letters, digits, and . _ - only,
// not leading with a separator. Keep the two in sync.
const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isValidTag(tag: string): boolean {
  return typeof tag === 'string' && TAG_RE.test(tag);
}

export type ReleaseVersion = {
  tag: string;
  label?: string;
  notes?: string;
  releasedAt?: string;
};

export type ReleaseManifest = { versions: ReleaseVersion[] };

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

// The updater's most recent progress, or null if nothing has run / the volume
// isn't mounted (e.g. local dev).
export function readStatus(): UpdateStatus | null {
  try {
    return JSON.parse(fs.readFileSync(UPDATE_STATUS_FILE, 'utf8')) as UpdateStatus;
  } catch {
    return null;
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
