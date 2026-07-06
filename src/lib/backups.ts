import fs from 'fs';
import path from 'path';

// Where the db-backup container writes backups (mounted read-only into the app)
// and where we drop the "back up now" flag it watches for.
export const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
export const BACKUP_TRIGGER_DIR = process.env.BACKUP_TRIGGER_DIR || '/backup-triggers';
export const BACKUP_TRIGGER_FILE = path.join(BACKUP_TRIGGER_DIR, 'backup-now');

// The exact names backup.sh writes. Also the allow-list for downloads — a request
// must match one of these, which blocks path traversal and any other filename.
const DUMP_RE = /^afct-(\d{8}-\d{6})\.dump$/;
const FILES_RE = /^afct-files-(\d{8}-\d{6})\.tgz$/;

export function isValidBackupName(name: string): boolean {
  return DUMP_RE.test(name) || FILES_RE.test(name);
}

export type BackupPair = {
  timestamp: string; // e.g. 20260706-223043
  dumpFile: string | null;
  dumpSize: number | null;
  filesFile: string | null;
  filesSize: number | null;
};

function safeSize(p: string): number | null {
  try {
    return fs.statSync(p).size;
  } catch {
    return null;
  }
}

// Backups grouped into { database, files } pairs by timestamp, newest first.
export function listBackups(): BackupPair[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(BACKUP_DIR);
  } catch {
    return []; // dir not mounted (e.g. local dev) → nothing to list
  }

  const byTs: Record<string, BackupPair> = {};
  for (const name of entries) {
    const dump = DUMP_RE.exec(name);
    const files = FILES_RE.exec(name);
    const ts = dump?.[1] ?? files?.[1];
    if (!ts) continue;
    byTs[ts] ??= {
      timestamp: ts,
      dumpFile: null,
      dumpSize: null,
      filesFile: null,
      filesSize: null,
    };
    const size = safeSize(path.join(BACKUP_DIR, name));
    if (dump) {
      byTs[ts].dumpFile = name;
      byTs[ts].dumpSize = size;
    } else {
      byTs[ts].filesFile = name;
      byTs[ts].filesSize = size;
    }
  }

  return Object.values(byTs).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
