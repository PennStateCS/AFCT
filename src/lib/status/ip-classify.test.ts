import { describe, expect, it } from 'vitest';
import { classifyIp, ipKindLabel } from '@/lib/status/ip-classify';

describe('classifyIp', () => {
  it.each([
    ['203.0.113.7', 4, 'public'],
    ['8.8.8.8', 4, 'public'],
    ['127.0.0.1', 4, 'loopback'],
    ['10.0.0.1', 4, 'private'],
    ['172.16.0.1', 4, 'private'],
    ['172.31.255.255', 4, 'private'],
    ['192.168.1.10', 4, 'private'],
    ['169.254.10.1', 4, 'link-local'],
    ['100.64.0.1', 4, 'shared'],
  ])('classifies the IPv4 address %s', (ip, version, kind) => {
    expect(classifyIp(ip)).toEqual({ version, kind });
  });

  it.each([
    ['172.15.0.1', 'public'], // just below the private 172.16/12 block
    ['172.32.0.1', 'public'], // just above it
    ['100.128.0.1', 'public'], // just above the carrier-shared 100.64/10 block
  ])('does not over-claim near a block boundary: %s', (ip, kind) => {
    expect(classifyIp(ip).kind).toBe(kind);
  });

  it.each([
    ['2001:db8::1', 6, 'public'],
    ['::1', 6, 'loopback'],
    ['fd00::1', 6, 'private'],
    ['fc00::1', 6, 'private'],
    ['fe80::1', 6, 'link-local'],
  ])('classifies the IPv6 address %s', (ip, version, kind) => {
    expect(classifyIp(ip)).toEqual({ version, kind });
  });

  it('reads through the IPv4-mapped IPv6 form a dual-stack proxy can produce', () => {
    expect(classifyIp('::ffff:192.168.4.4')).toEqual({ version: 4, kind: 'private' });
    expect(classifyIp('::ffff:203.0.113.9')).toEqual({ version: 4, kind: 'public' });
  });

  it('reports the limiter placeholder for a request with no readable address', () => {
    // `getClientIp` yields nothing and the limiter stores the literal "unknown".
    expect(classifyIp('unknown')).toEqual({ version: null, kind: 'unknown' });
    expect(classifyIp('')).toEqual({ version: null, kind: 'unknown' });
  });

  it('does not mistake a malformed address for IPv4', () => {
    for (const bad of ['1.2.3', '1.2.3.4.5', '256.1.1.1', '01.2.3.4', 'not-an-ip']) {
      expect(classifyIp(bad)).toEqual({ version: null, kind: 'unknown' });
    }
  });

  it('gives every kind a plain-language label', () => {
    for (const kind of ['public', 'private', 'loopback', 'link-local', 'shared', 'unknown'] as const) {
      expect(ipKindLabel(kind)).toMatch(/[a-z]/);
    }
  });
});
