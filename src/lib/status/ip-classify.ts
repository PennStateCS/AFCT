/**
 * What can be said about an IP address with no lookup at all: which version it is and
 * which part of the address space it belongs to. Pure and synchronous, so it works the
 * same offline, and it is what decides whether a reverse-DNS lookup is worth attempting
 * (a private or loopback address almost never has a useful public name).
 */

import type { IpKind } from '@/lib/status/types';

const KIND_LABELS: Record<IpKind, string> = {
  public: 'Public internet address',
  private: 'Private network address',
  loopback: 'This server (loopback)',
  'link-local': 'Link-local address',
  shared: 'Carrier-shared address',
  unknown: 'Address could not be determined',
};

export const ipKindLabel = (kind: IpKind) => KIND_LABELS[kind];

const parseIpv4 = (value: string): number[] | null => {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    // Reject empty, non-numeric, and zero-padded forms; the latter are ambiguous.
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith('0')) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
};

const classifyIpv4 = ([a = 0, b = 0]: number[]): IpKind => {
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 169 && b === 254) return 'link-local';
  // 100.64.0.0/10, handed out by carrier-grade NAT: many subscribers behind one address.
  if (a === 100 && b >= 64 && b <= 127) return 'shared';
  return 'public';
};

const classifyIpv6 = (value: string): IpKind => {
  if (value === '::1') return 'loopback';
  if (value === '::') return 'unknown';
  const head = value.slice(0, 2);
  // fc00::/7 unique local, fe80::/10 link-local.
  if (head === 'fc' || head === 'fd') return 'private';
  if (value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea')) {
    return 'link-local';
  }
  if (value.startsWith('feb')) return 'link-local';
  return 'public';
};

export type IpClassification = { version: 4 | 6 | null; kind: IpKind };

/**
 * Classify one address. Handles the IPv4-mapped IPv6 form (`::ffff:203.0.113.1`) that a
 * dual-stack proxy can produce by classifying the embedded IPv4 address, and returns
 * `unknown` for the literal placeholder the rate limiter stores when no client address
 * could be read off the request.
 */
export const classifyIp = (value: string): IpClassification => {
  const ip = value.trim().toLowerCase();
  if (!ip || ip === 'unknown') return { version: null, kind: 'unknown' };

  const mapped = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : null;
  const v4 = parseIpv4(mapped ?? ip);
  if (v4) return { version: 4, kind: classifyIpv4(v4) };

  // Anything left containing a colon is treated as IPv6; the limiter only ever stores
  // what `getClientIp` produced, so this does not need to be a full validator.
  if (ip.includes(':')) return { version: 6, kind: classifyIpv6(ip) };

  return { version: null, kind: 'unknown' };
};
