import type { NextRequest } from 'next/server';

/** Anything that exposes a header lookup (Request, NextRequest, or next/headers' ReadonlyHeaders). */
type HeaderGetter = { get(name: string): string | null };

/**
 * Strip the IPv4-mapped IPv6 prefix (e.g. "::ffff:172.18.0.1" -> "172.18.0.1")
 * so addresses read cleanly. Genuine IPv6 addresses are left untouched.
 */
export function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:(?=\d{1,3}(?:\.\d{1,3}){3}$)/i, '');
}

/**
 * The client address, as the deployment's own nginx reports it.
 *
 * Why this may trust `X-Forwarded-For` at all: the app container's port is never
 * published in the shipped composes, so the only way a request reaches this code is
 * through the bundled nginx, and that nginx OVERWRITES the header with the TCP peer's
 * address rather than appending to whatever the client sent (`proxy_set_header
 * X-Forwarded-For $remote_addr` in docker/nginx/default.conf). The list therefore
 * always holds exactly one entry and that entry is the connection's real source;
 * reading the first entry is correct because of that overwrite, not as a general
 * rule. `X-Real-IP` is set by the same nginx to the same value and is the fallback.
 *
 * Nothing else is consulted. This used to also try `CF-Connecting-IP` and
 * `X-Client-IP`, which our nginx neither sets nor strips: they arrived from the
 * client verbatim, so each was a spoofable path into the audit log for any caller
 * that could reach a branch below the first. An install that really sits behind a CDN
 * records the CDN edge's address, which is the honest reading of what nginx saw.
 *
 * If nginx itself sits behind an institution's own load balancer, every request
 * records the balancer's address. Fixing that is an nginx `set_real_ip_from`
 * decision for that install, made by whoever knows the balancer's address; guessing
 * here by trusting deeper into the header would reopen the spoof.
 */
export function getClientIpFromHeaders(headers: HeaderGetter): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const ip = forwarded.split(',')[0]?.trim();
    if (ip && ip !== '::1' && ip !== '127.0.0.1') {
      return normalizeIp(ip);
    }
  }

  const realIp = headers.get('x-real-ip');
  if (realIp && realIp !== '::1' && realIp !== '127.0.0.1') {
    return normalizeIp(realIp);
  }

  // Development also publishes the app port directly (3000), where no header can be
  // trusted; a stable placeholder beats recording whatever the request claimed.
  if (process.env.NODE_ENV === 'development') {
    return 'localhost-dev';
  }

  // Last resort - if all headers point to localhost, just return localhost
  if (forwarded === '::1' || realIp === '::1') {
    return 'localhost';
  }

  return 'unknown';
}

/**
 * Extracts the client IP address from various headers and fallbacks.
 * Works with NextRequest, standard Request, or a null/undefined source
 * (e.g. an auth callback with no request), in which case the header-less
 * fallbacks apply.
 */
export function getClientIp(req?: NextRequest | Request | null): string {
  return getClientIpFromHeaders(req?.headers ?? new Headers());
}
