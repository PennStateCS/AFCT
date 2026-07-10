import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getClientIp, getClientIpSimple, getRequestMetadata, normalizeIp } from './ip-utils';

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

    it('should skip localhost in x-real-ip and use cf-connecting-ip', () => {
      const req = createMockRequest({
        'x-real-ip': '::1',
        'cf-connecting-ip': '104.16.123.96',
      });
      expect(getClientIp(req)).toBe('104.16.123.96');
    });

    it('should use cf-connecting-ip (Cloudflare)', () => {
      const req = createMockRequest({
        'cf-connecting-ip': '104.16.123.96',
      });
      expect(getClientIp(req)).toBe('104.16.123.96');
    });

    it('should use x-client-ip (AWS ALB)', () => {
      const req = createMockRequest({
        'x-client-ip': '52.84.12.34',
      });
      expect(getClientIp(req)).toBe('52.84.12.34');
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

    it('should prioritize x-forwarded-for over other headers', () => {
      const req = createMockRequest({
        'x-forwarded-for': '203.0.113.1',
        'x-real-ip': '203.0.113.2',
        'cf-connecting-ip': '203.0.113.3',
        'x-client-ip': '203.0.113.4',
      });
      expect(getClientIp(req)).toBe('203.0.113.1');
    });

    it('should handle empty x-forwarded-for value', () => {
      const req = createMockRequest({
        'x-forwarded-for': '',
        'x-real-ip': '198.51.100.50',
      });
      expect(getClientIp(req)).toBe('198.51.100.50');
    });
  });

  describe('getClientIpSimple', () => {
    it('should extract IP from x-forwarded-for header', () => {
      const req = createMockRequest({
        'x-forwarded-for': '203.0.113.195, 70.41.3.18',
      });
      expect(getClientIpSimple(req)).toBe('203.0.113.195');
    });

    it('should use x-real-ip as fallback', () => {
      const req = createMockRequest({
        'x-real-ip': '198.51.100.100',
      });
      expect(getClientIpSimple(req)).toBe('198.51.100.100');
    });

    it('should return "localhost-dev" in development mode', () => {
      vi.stubEnv('NODE_ENV', 'development');
      const req = createMockRequest({});
      expect(getClientIpSimple(req)).toBe('localhost-dev');
    });

    it('should return "localhost" when forwarded is ::1', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const req = createMockRequest({
        'x-forwarded-for': '::1',
      });
      expect(getClientIpSimple(req)).toBe('localhost');
    });

    it('should return "localhost" when x-real-ip is ::1', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const req = createMockRequest({
        'x-real-ip': '::1',
      });
      expect(getClientIpSimple(req)).toBe('localhost');
    });

    it('should return "unknown" when no valid headers in production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const req = createMockRequest({});
      expect(getClientIpSimple(req)).toBe('unknown');
    });

    it('should skip localhost IPs in x-forwarded-for', () => {
      const req = createMockRequest({
        'x-forwarded-for': '127.0.0.1',
        'x-real-ip': '203.0.113.50',
      });
      expect(getClientIpSimple(req)).toBe('203.0.113.50');
    });
  });

  describe('getRequestMetadata', () => {
    it('should extract comprehensive metadata from request', () => {
      const req = createMockRequest({
        'x-forwarded-for': '203.0.113.195',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        referer: 'https://example.com/previous',
        origin: 'https://example.com',
      });

      const metadata = getRequestMetadata(req as any);

      expect(metadata).toEqual({
        ipAddress: '203.0.113.195',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        referer: 'https://example.com/previous',
        origin: 'https://example.com',
        timestamp: '2026-02-08T12:00:00.000Z',
      });
    });

    it('should handle missing optional headers', () => {
      const req = createMockRequest({
        'x-forwarded-for': '198.51.100.42',
      });

      const metadata = getRequestMetadata(req as any);

      expect(metadata).toEqual({
        ipAddress: '198.51.100.42',
        userAgent: 'unknown',
        referer: null,
        origin: null,
        timestamp: '2026-02-08T12:00:00.000Z',
      });
    });

    it('should include current timestamp', () => {
      const req = createMockRequest({
        'x-real-ip': '104.16.50.100',
      });

      const metadata = getRequestMetadata(req as any);
      expect(metadata.timestamp).toBe('2026-02-08T12:00:00.000Z');
    });

    it('should use getClientIp for IP extraction', () => {
      const req = createMockRequest({
        'cf-connecting-ip': '104.16.123.96',
      });

      const metadata = getRequestMetadata(req as any);
      expect(metadata.ipAddress).toBe('104.16.123.96');
    });

    it('should handle all fields being null except IP', () => {
      const req = createMockRequest({
        'x-client-ip': '52.84.12.34',
      });

      const metadata = getRequestMetadata(req as any);

      expect(metadata.ipAddress).toBe('52.84.12.34');
      expect(metadata.userAgent).toBe('unknown');
      expect(metadata.referer).toBeNull();
      expect(metadata.origin).toBeNull();
      expect(metadata.timestamp).toBeTruthy();
    });
  });
});
