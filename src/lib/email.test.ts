import { describe, expect, it } from 'vitest';
import {
  normalizeEmail,
  isValidEmail,
  getEmailDomain,
  isValidDomain,
  parseDomainList,
  isEmailDomainAllowed,
} from './email';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com');
  });
  it('returns "" for non-string input', () => {
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
    expect(normalizeEmail(123)).toBe('');
  });
  it('supports the "|| null" idiom for absent values', () => {
    expect(normalizeEmail(null) || null).toBeNull();
  });
});

describe('isValidEmail', () => {
  it('accepts a well-formed address', () => {
    expect(isValidEmail('foo@example.com')).toBe(true);
  });
  it('rejects obvious junk', () => {
    for (const bad of ['', 'foo', 'foo@', '@bar.com', 'foo@bar', 'a b@c.com']) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });
});

describe('getEmailDomain', () => {
  it('returns the lowercased domain', () => {
    expect(getEmailDomain('Ada@PSU.edu')).toBe('psu.edu');
    expect(getEmailDomain('a@b@mail.example.com')).toBe('mail.example.com'); // splits on last @
  });
  it('returns "" for a malformed address', () => {
    expect(getEmailDomain('nope')).toBe('');
    expect(getEmailDomain('')).toBe('');
  });
});

describe('isValidDomain', () => {
  it('accepts real domains', () => {
    for (const d of ['psu.edu', 'mail.psu.edu', 'a-b.example.co', 'x.io']) {
      expect(isValidDomain(d)).toBe(true);
    }
  });
  it('rejects junk / non-domains', () => {
    for (const d of ['', 'psu', 'psu.', '.edu', '@psu.edu', 'psu edu', 'http://psu.edu', '-psu.edu']) {
      expect(isValidDomain(d)).toBe(false);
    }
  });
});

describe('parseDomainList', () => {
  it('splits on commas/semicolons/whitespace, strips @, lowercases, dedupes', () => {
    const { domains, invalid } = parseDomainList(' @PSU.edu, psu.edu\n example.com; Example.com ');
    expect(domains).toEqual(['psu.edu', 'example.com']);
    expect(invalid).toEqual([]);
  });
  it('reports invalid tokens separately', () => {
    const { domains, invalid } = parseDomainList('psu.edu, notadomain, foo.org');
    expect(domains).toEqual(['psu.edu', 'foo.org']);
    expect(invalid).toEqual(['notadomain']);
  });
  it('returns empty for a blank list', () => {
    expect(parseDomainList('').domains).toEqual([]);
    expect(parseDomainList('   ').domains).toEqual([]);
  });
});

describe('isEmailDomainAllowed', () => {
  it('allows any domain when the list is blank', () => {
    expect(isEmailDomainAllowed('anyone@whatever.com', '')).toBe(true);
    expect(isEmailDomainAllowed('anyone@whatever.com', '   ')).toBe(true);
  });
  it('allows a listed domain (case-insensitive) and rejects others', () => {
    expect(isEmailDomainAllowed('Ada@PSU.edu', 'psu.edu,example.com')).toBe(true);
    expect(isEmailDomainAllowed('ada@gmail.com', 'psu.edu,example.com')).toBe(false);
  });
  it('does not match on a suffix (subdomain must be listed explicitly)', () => {
    expect(isEmailDomainAllowed('ada@mail.psu.edu', 'psu.edu')).toBe(false);
  });
});
