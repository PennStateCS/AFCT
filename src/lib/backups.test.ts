import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { isValidBackupName, listBackups } from '@/lib/backups';

afterEach(() => vi.restoreAllMocks());

describe('isValidBackupName', () => {
  it('accepts exact dump and files archive names', () => {
    expect(isValidBackupName('afct-20260706-223043.dump')).toBe(true);
    expect(isValidBackupName('afct-files-20260706-223043.tgz')).toBe(true);
  });

  it('rejects traversal attempts and anything off the allow-list', () => {
    expect(isValidBackupName('../etc/passwd')).toBe(false);
    expect(isValidBackupName('afct-20260706-223043.dump/../secret')).toBe(false);
    expect(isValidBackupName('/backups/afct-20260706-223043.dump')).toBe(false);
    expect(isValidBackupName('afct-20260706.dump')).toBe(false); // wrong timestamp shape
    expect(isValidBackupName('afct-20260706-223043.dump.evil')).toBe(false);
    expect(isValidBackupName('server.key')).toBe(false);
    expect(isValidBackupName('')).toBe(false);
  });
});

describe('listBackups', () => {
  it('returns [] when the backup directory is not mounted', () => {
    vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(listBackups()).toEqual([]);
  });

  it('pairs dump + files by timestamp, newest first, ignoring stray files', () => {
    vi.spyOn(fs, 'readdirSync').mockReturnValue([
      'afct-20260101-010101.dump',
      'afct-files-20260101-010101.tgz',
      'afct-20260202-020202.dump',
      'not-a-backup.txt',
      '.last-backup-date',
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: 100 } as unknown as fs.Stats);

    const list = listBackups();
    expect(list.map((b) => b.timestamp)).toEqual(['20260202-020202', '20260101-010101']);

    // Newest has only a dump so far.
    expect(list[0]).toMatchObject({
      dumpFile: 'afct-20260202-020202.dump',
      filesFile: null,
    });
    // Older is a complete pair.
    expect(list[1]).toMatchObject({
      dumpFile: 'afct-20260101-010101.dump',
      filesFile: 'afct-files-20260101-010101.tgz',
      dumpSize: 100,
      filesSize: 100,
    });
  });
});
