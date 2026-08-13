/**
 * AFCT's own address, as configured by whoever installed it.
 *
 * Anything sent *out* of AFCT has to be built from this rather than from the request that
 * happened to trigger it. A password-reset link built from the incoming `Host` header is a link
 * an attacker can choose: send a reset request with a forged host and the victim's email carries
 * a URL pointing at the attacker's server, with a live token on the end of it. So the host is
 * never consulted here, only the value an administrator set.
 *
 * The other half of the job is refusing to pretend. `NEXTAUTH_URL` unset used to produce
 * `/reset-password?token=...`, a relative link that is not a link at all once it is in a mail
 * client. A reset email nobody can use is worse than a site that says plainly it cannot send one.
 */

/** Why the configured address cannot be used to build a link somebody will follow. */
export type PublicUrlProblem =
  /** Nothing configured at all. */
  | 'missing'
  /** Configured, but not something `URL` will parse as absolute. */
  | 'malformed'
  /** Parsed, but not a scheme a browser follows from an email. */
  | 'unsupported-scheme'
  /** Plain HTTP against something other than this machine, where a token would travel in clear. */
  | 'insecure';

export type PublicUrlResult =
  | { ok: true; origin: string }
  | { ok: false; problem: PublicUrlProblem; message: string };

/** Hosts where plain HTTP is somebody developing rather than a real deployment. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The configured public address, or why it cannot be used.
 *
 * Returns the origin plus path with any trailing slashes removed, so callers can append a path
 * without thinking about it.
 */
export function getPublicAppUrl(): PublicUrlResult {
  const raw = (process.env.NEXTAUTH_URL ?? '').trim();

  if (!raw) {
    return {
      ok: false,
      problem: 'missing',
      message:
        'This site does not know its own web address, so AFCT cannot build a link to put in an email. Set NEXTAUTH_URL to the address people use to reach AFCT, then restart it.',
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      ok: false,
      problem: 'malformed',
      message: `This site's web address is not a valid one ("${raw}"), so AFCT cannot build a link to put in an email. Set NEXTAUTH_URL to a full address such as https://afct.example.edu, then restart it.`,
    };
  }

  // A mail client will not follow anything else, and a `file:` or `javascript:` URL in an
  // outbound email is a great deal worse than a broken one.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      problem: 'unsupported-scheme',
      message: `This site's web address uses "${url.protocol}", which nobody can open from an email. Set NEXTAUTH_URL to an http:// or https:// address, then restart it.`,
    };
  }

  /**
   * Plain HTTP is allowed only against this machine, which is somebody running AFCT locally.
   * Anywhere else it means a reset token crossing a network in the clear, and the token is the
   * whole account: anyone who reads it in transit can take it.
   */
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) {
    return {
      ok: false,
      problem: 'insecure',
      message: `This site's web address (${url.origin}) is not secure, and a password reset link sent over it could be read in transit. Set NEXTAUTH_URL to the https:// address, then restart AFCT.`,
    };
  }

  return { ok: true, origin: `${url.origin}${url.pathname}`.replace(/\/+$/, '') };
}

/**
 * Build an absolute URL onto the configured address.
 *
 * Throws rather than returning something relative: a caller that forgets to check and quietly
 * emails a broken link is the failure this exists to prevent.
 */
export function publicAppUrl(path: string): string {
  const result = getPublicAppUrl();
  if (!result.ok) throw new PublicUrlError(result.message, result.problem);
  return `${result.origin}${path.startsWith('/') ? path : `/${path}`}`;
}

export class PublicUrlError extends Error {
  constructor(
    message: string,
    readonly problem: PublicUrlProblem,
  ) {
    super(message);
    this.name = 'PublicUrlError';
  }
}
