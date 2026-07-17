import { describe, it, expect } from 'vitest';
import { safeCallbackUrl } from './safe-callback';

describe('safeCallbackUrl', () => {
  it('keeps a same-origin relative path, including the query string', () => {
    expect(safeCallbackUrl('/dashboard?joinCode=ABCD2345')).toBe('/dashboard?joinCode=ABCD2345');
    expect(safeCallbackUrl('/dashboard')).toBe('/dashboard');
    expect(safeCallbackUrl('/dashboard/courses/1')).toBe('/dashboard/courses/1');
  });

  it('falls back for open-redirect attempts', () => {
    expect(safeCallbackUrl('//evil.com')).toBe('/dashboard');
    expect(safeCallbackUrl('/\\evil.com')).toBe('/dashboard');
    expect(safeCallbackUrl('https://evil.com')).toBe('/dashboard');
    expect(safeCallbackUrl('javascript:alert(1)')).toBe('/dashboard');
    expect(safeCallbackUrl('evil.com')).toBe('/dashboard');
  });

  it('falls back for empty or control-character input', () => {
    expect(safeCallbackUrl(null)).toBe('/dashboard');
    expect(safeCallbackUrl(undefined)).toBe('/dashboard');
    expect(safeCallbackUrl('')).toBe('/dashboard');
    expect(safeCallbackUrl('/x\nSet-Cookie: y')).toBe('/dashboard');
  });

  it('honors a custom fallback', () => {
    expect(safeCallbackUrl(null, '/login')).toBe('/login');
  });
});
