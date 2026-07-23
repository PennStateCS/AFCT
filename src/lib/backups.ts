import fs from 'fs';
import path from 'path';

// Where the db-backup container writes backups (mounted read-only into the app)
// and where we drop the "back up now" flag it watches for.
export const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
export const BACKUP_TRIGGER_DIR = process.env.BACKUP_TRIGGER_DIR || '/backup-triggers';
export const BACKUP_TRIGGER_FILE = path.join(BACKUP_TRIGGER_DIR, 'backup-now');

// The exact names backup.sh writes: one archive per run, holding both the database
// dump and the uploads, `.gpg` when a passphrase is configured. This is also the
// allow-list for downloads -- a request must match it, which blocks path traversal
// and any other filename.
const ARCHIVE_RE = /^afct-(\d{8}-\d{6})\.tar\.gz(\.gpg)?$/;

export function isValidBackupName(name: string): boolean {
  return ARCHIVE_RE.test(name);
}

export type Backup = {
  timestamp: string; // e.g. 20260706-223043
  file: string;
  size: number | null;
  encrypted: boolean;
};

function safeSize(p: string): number | null {
  try {
    return fs.statSync(p).size;
  } catch {
    return null;
  }
}

/** Backups in the backup directory, newest first. */
export function listBackups(): Backup[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(BACKUP_DIR);
  } catch {
    return []; // dir not mounted (e.g. local dev) → nothing to list
  }

  const backups: Backup[] = [];
  for (const name of entries) {
    const match = ARCHIVE_RE.exec(name);
    if (!match?.[1]) continue;
    backups.push({
      timestamp: match[1],
      file: name,
      size: safeSize(path.join(BACKUP_DIR, name)),
      encrypted: Boolean(match[2]),
    });
  }

  return backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
