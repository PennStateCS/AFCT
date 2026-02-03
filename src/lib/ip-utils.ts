import { NextRequest } from 'next/server';

/**
 * Extracts the client IP address from various headers and fallbacks
 * Works with both NextRequest and standard Request types
 */
export function getClientIp(req: NextRequest | Request): string {
  // Try various headers that proxies might set
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    // x-forwarded-for can contain multiple IPs, first one is the original client
    const ip = forwarded.split(',')[0]?.trim();
    if (ip && ip !== '::1' && ip !== '127.0.0.1') {
      return ip;
    }
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp !== '::1' && realIp !== '127.0.0.1') {
    return realIp;
  }

  // Cloudflare sets this header
  const cfConnectingIp = req.headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  // AWS ALB sets this
  const clientIp = req.headers.get('x-client-ip');
  if (clientIp) {
    return clientIp;
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
