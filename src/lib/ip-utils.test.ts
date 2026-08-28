import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getClientIp, normalizeIp } from './ip-utils';

// Helper to create mock Request with headers
function createMockRequest(headers: Record<string, string> = {}): Request {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] || null,
    },
  } as Request;
}

describe('ip-utils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-08T12:00:00Z'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  describe('normalizeIp', () => {
    it('strips the ::ffff: prefix from IPv4-mapped addresses', () => {
      expect(normalizeIp('::ffff:172.18.0.1')).toBe('172.18.0.1');
    });

    it('leaves plain IPv4 addresses unchanged', () => {
      expect(normalizeIp('203.0.113.195')).toBe('203.0.113.195');
    });

    it('leaves genuine IPv6 addresses unchanged', () => {
      expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
      expect(normalizeIp('::ffff:beef')).toBe('::ffff:beef');
    });
  });

  describe('getClientIp', () => {
    it('should extract IP from x-forwarded-for header (first IP)', () => {
      const req = createMockRequest({
        'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178',
      });
      expect(getClientIp(req)).toBe('203.0.113.195');
    });

    it('normalizes an IPv4-mapped IPv6 client address', () => {
      const req = createMockRequest({ 'x-forwarded-for': '::ffff:172.18.0.1' });
      expect(getClientIp(req)).toBe('172.18.0.1');
    });

    it('should trim whitespace from x-forwarded-for IP', () => {
      const req = createMockRequest({
        'x-forwarded-for': '  192.168.1.100  , 10.0.0.1',
      });
      expect(getClientIp(req)).toBe('192.168.1.100');
    });

    it('should skip localhost IPs in x-forwarded-for and use x-real-ip', () => {
      const req = createMockRequest({
        'x-forwarded-for': '::1',
        'x-real-ip': '203.0.113.50',
      });
      expect(getClientIp(req)).toBe('203.0.113.50');
    });

    it('should skip 127.0.0.1 in x-forwarded-for and use x-real-ip', () => {
      const req = createMockRequest({
        'x-forwarded-for': '127.0.0.1',
        'x-real-ip': '198.51.100.42',
      });
      expect(getClientIp(req)).toBe('198.51.100.42');
    });

    it('should use x-real-ip when x-forwarded-for is missing', () => {
      const req = createMockRequest({
        'x-real-ip': '198.51.100.100',
      });
      expect(getClientIp(req)).toBe('198.51.100.100');
    });

    it('should return "localhost-dev" in development mode with no valid IP', () => {
      vi.stubEnv('NODE_ENV', 'development');
      const req = createMockRequest({});
      expect(getClientIp(req)).toBe('localhost-dev');
    });

    it('should return "localhost" when forwarded is ::1', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const req = createMockRequest({
        'x-forwarded-for': '::1',
      });
      expect(getClientIp(req)).toBe('localhost');
    });

    it('should return "localhost" when x-real-ip is ::1', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const req = createMockRequest({
        'x-real-ip': '::1',
      });
      expect(getClientIp(req)).toBe('localhost');
    });

    it('should return "unknown" when no headers are present in production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const req = createMockRequest({});
      expect(getClientIp(req)).toBe('unknown');
    });

    it('reads only what nginx set, never a client-supplied CDN header', () => {
      const req = createMockRequest({
        'x-forwarded-for': '203.0.113.1',
        'x-real-ip': '203.0.113.2',
        'cf-connecting-ip': '203.0.113.3',
        'x-client-ip': '203.0.113.4',
      });
      expect(getClientIp(req)).toBe('203.0.113.1');
    });

    /**
     * These two arrive from the client verbatim: the bundled nginx neither sets nor strips
     * them. Trusting either was a spoofable path into the audit log, so they are ignored
     * even when nothing else identifies the caller.
     */
    it('ignores CF-Connecting-IP and X-Client-IP outright', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const req = createMockRequest({
        'cf-connecting-ip': '203.0.113.3',
        'x-client-ip': '203.0.113.4',
      });
      expect(getClientIp(req)).toBe('unknown');
    });

    it('ignores them even when the trusted headers are localhost', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const req = createMockRequest({
        'x-forwarded-for': '::1',
        'x-real-ip': '::1',
        'cf-connecting-ip': '203.0.113.3',
      });
      expect(getClientIp(req)).toBe('localhost');
    });

    it('should handle empty x-forwarded-for value', () => {
      const req = createMockRequest({
        'x-forwarded-for': '',
        'x-real-ip': '198.51.100.50',
      });
      expect(getClientIp(req)).toBe('198.51.100.50');
    });
  });
});
