import { NextRequest } from 'next/server';

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
 * Extracts the client IP address from a header source (proxy headers first,
 * then dev/localhost fallbacks). Accepts a Headers-like object so it works
 * with both incoming requests and `next/headers` in event/action contexts.
 */
export function getClientIpFromHeaders(headers: HeaderGetter): string {
  // Try various headers that proxies might set
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    // x-forwarded-for can contain multiple IPs, first one is the original client
    const ip = forwarded.split(',')[0]?.trim();
    if (ip && ip !== '::1' && ip !== '127.0.0.1') {
      return normalizeIp(ip);
    }
  }

  const realIp = headers.get('x-real-ip');
  if (realIp && realIp !== '::1' && realIp !== '127.0.0.1') {
    return normalizeIp(realIp);
  }

  // Cloudflare sets this header
  const cfConnectingIp = headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return normalizeIp(cfConnectingIp);
  }

  // AWS ALB sets this
  const clientIp = headers.get('x-client-ip');
  if (clientIp) {
    return normalizeIp(clientIp);
  }

  // Check if we're in development mode
  if (process.env.NODE_ENV === 'development') {
    // In development, try to get a more meaningful identifier
    // We could use the User-Agent or session info for tracking instead
    return 'localhost-dev';
  }

  // Last resort - if all headers point to localhost, just return localhost
  if (forwarded === '::1' || realIp === '::1') {
    return 'localhost';
  }

  return 'unknown';
}

/**
 * Extracts the client IP address from various headers and fallbacks
 * Works with both NextRequest and standard Request types
 */
export function getClientIp(req: NextRequest | Request): string {
  return getClientIpFromHeaders(req.headers);
}

/**
 * Simple IP extraction for standard Request objects
 */
export function getClientIpSimple(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const ip = forwarded.split(',')[0]?.trim();
    if (ip && ip !== '::1' && ip !== '127.0.0.1') {
      return ip;
    }
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp !== '::1' && realIp !== '127.0.0.1') {
    return realIp;
  }

  if (process.env.NODE_ENV === 'development') {
    return 'localhost-dev';
  }

  return forwarded === '::1' || realIp === '::1' ? 'localhost' : 'unknown';
}

/**
 * Get comprehensive request metadata for logging
 */
export function getRequestMetadata(req: NextRequest) {
  const ip = getClientIp(req);
  const userAgent = req.headers.get('user-agent') || 'unknown';
  
  // Additional metadata that might be useful
  const referer = req.headers.get('referer');
  const origin = req.headers.get('origin');
  
  return {
    ipAddress: ip,
    userAgent,
    referer,
    origin,
    timestamp: new Date().toISOString(),
  };
}
