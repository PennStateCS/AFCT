import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { isValidBackupName, listBackups } from '@/lib/backups';

afterEach(() => vi.restoreAllMocks());

describe('isValidBackupName', () => {
  it('accepts the encrypted and plaintext archive names', () => {
    expect(isValidBackupName('afct-20260706-223043.tar.gz.gpg')).toBe(true);
    expect(isValidBackupName('afct-20260706-223043.tar.gz')).toBe(true);
  });

  it('rejects traversal attempts and anything off the allow-list', () => {
    expect(isValidBackupName('../etc/passwd')).toBe(false);
    expect(isValidBackupName('afct-20260706-223043.tar.gz/../secret')).toBe(false);
    expect(isValidBackupName('/backups/afct-20260706-223043.tar.gz')).toBe(false);
    expect(isValidBackupName('afct-20260706.tar.gz')).toBe(false); // wrong timestamp shape
    expect(isValidBackupName('afct-20260706-223043.tar.gz.evil')).toBe(false);
    expect(isValidBackupName('server.key')).toBe(false);
    expect(isValidBackupName('')).toBe(false);
  });

  it('rejects the retired pair format', () => {
    expect(isValidBackupName('afct-20260706-223043.dump')).toBe(false);
    expect(isValidBackupName('afct-files-20260706-223043.tgz')).toBe(false);
  });
});

describe('listBackups', () => {
  it('returns [] when the backup directory is not mounted', () => {
    vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(listBackups()).toEqual([]);
  });

  it('lists archives newest first, flagging encryption and ignoring strays', () => {
    vi.spyOn(fs, 'readdirSync').mockReturnValue([
      'afct-20260101-010101.tar.gz.gpg',
      'afct-20260202-020202.tar.gz',
      'afct-20251231-235959.dump', // retired format: not listed
      'not-a-backup.txt',
      '.last-backup-date',
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: 100 } as unknown as fs.Stats);

    const list = listBackups();
    expect(list.map((b) => b.timestamp)).toEqual(['20260202-020202', '20260101-010101']);

    expect(list[0]).toEqual({
      timestamp: '20260202-020202',
      file: 'afct-20260202-020202.tar.gz',
      size: 100,
      encrypted: false,
    });
    expect(list[1]).toEqual({
      timestamp: '20260101-010101',
      file: 'afct-20260101-010101.tar.gz.gpg',
      size: 100,
      encrypted: true,
    });
  });
});
