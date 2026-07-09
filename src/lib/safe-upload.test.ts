import { describe, it, expect } from 'vitest';
import path from 'path';
import { safeExtension, safeStoredFilename, resolveInsideDir } from './safe-upload';

describe('safeExtension', () => {
  it('keeps a normal extension, lowercased', () => {
    expect(safeExtension('answer.JFF')).toBe('.jff');
    expect(safeExtension('a.xml')).toBe('.xml');
  });

  it('returns empty for missing, weird, or unsafe extensions', () => {
    expect(safeExtension(undefined)).toBe('');
    expect(safeExtension('noext')).toBe('');
    expect(safeExtension('../../etc/passwd')).toBe(''); // extname is ''
    expect(safeExtension('evil.php.')).toBe(''); // trailing dot -> extname ''
    expect(safeExtension('x.<script>')).toBe(''); // non-alnum
    expect(safeExtension('x.' + 'a'.repeat(20))).toBe(''); // too long
  });
});

describe('safeStoredFilename', () => {
  it('is a uuid plus the sanitized extension, never the original name', () => {
    const name = safeStoredFilename('../../evil name.JFF');
    expect(name).not.toContain('evil');
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
    expect(name).toMatch(/^[0-9a-f-]{36}\.jff$/);
  });

  it('applies a safe prefix and drops an unsafe extension', () => {
    const name = safeStoredFilename('weird.<x>', 'user1-');
    expect(name).toMatch(/^user1-[0-9a-f-]{36}$/);
  });
});

describe('resolveInsideDir', () => {
  const dir = path.join('/private', 'uploads', 'solutions');

  it('resolves a safe filename inside the dir', () => {
    expect(resolveInsideDir(dir, 'abc.jff')).toBe(path.resolve(dir, 'abc.jff'));
  });

  it('throws when the name would escape the dir', () => {
    expect(() => resolveInsideDir(dir, '../../etc/passwd')).toThrow(/escapes/);
    expect(() => resolveInsideDir(dir, '/etc/passwd')).toThrow(/escapes/);
  });
});
