/**
 * Link-URL policy for rich descriptions.
 *
 * Deliberately a tiny allowlist rather than a blocklist: only `https:` and `mailto:` are
 * accepted, so nothing has to reason about `javascript:`, `data:`, `vbscript:`, or any future
 * scheme. Plain `http:` is rejected too, and the message says to use https, because AFCT is
 * TLS-only in every supported deployment and a mixed-content link would be blocked anyway.
 *
 * Server-safe (no DOM). The editor uses it for the link dialog, and the same function backs
 * validation of stored documents, so a hand-crafted payload cannot smuggle a scheme past the
 * UI.
 */

export const ALLOWED_LINK_PROTOCOLS = ['https:', 'mailto:'] as const;

export type LinkUrlResult = { ok: true; href: string } | { ok: false; error: string };

// Whitespace and C0/C1 control characters. Browsers strip some of these before parsing the
// scheme, which is exactly how `java\tscript:` slips past a naive prefix check, so anything
// containing them is rejected outright rather than silently rewritten.
const FORBIDDEN_CHARS = /[\s\u0000-\u001f\u007f-\u009f]/;

/**
 * Validate and normalize a user-entered link URL. Returns the href to store on success.
 */
export function validateLinkUrl(raw: string): LinkUrlResult {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, error: 'Enter a web address.' };

  if (FORBIDDEN_CHARS.test(trimmed)) {
    return { ok: false, error: 'A web address cannot contain spaces or control characters.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      error:
        'Enter a full web address starting with https:// (or an email as mailto:name@example.edu).',
    };
  }

  if (!ALLOWED_LINK_PROTOCOLS.includes(parsed.protocol as never)) {
    // Name the offending scheme so the message is actionable, but never echo the rest of the
    // URL back into the UI.
    if (parsed.protocol === 'http:') {
      return { ok: false, error: 'Use https:// for web links.' };
    }
    return { ok: false, error: `Links cannot use ${parsed.protocol} addresses.` };
  }

  // Userinfo is rejected outright. `https://example.edu@evil.test` reads as a link to
  // example.edu and navigates to evil.test, which is the classic disguised-host shape, and a
  // credential embedded in a course description would be a leak in its own right.
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      error: 'A web address cannot contain a username or password.',
    };
  }

  // A mailto: with no recipient is a dead link.
  if (parsed.protocol === 'mailto:' && !parsed.pathname.includes('@')) {
    return { ok: false, error: 'Enter an email address, for example mailto:name@example.edu.' };
  }

  // An https: URL with no host is likewise unusable (e.g. "https://").
  if (parsed.protocol === 'https:' && !parsed.hostname) {
    return {
      ok: false,
      error: 'Enter a web address that includes a site, for example https://example.edu.',
    };
  }

  return { ok: true, href: parsed.href };
}

/** Cheap predicate for validating stored documents. */
export function isAllowedLinkHref(href: unknown): boolean {
  return typeof href === 'string' && validateLinkUrl(href).ok;
}

/** How a stored link should be rendered, or null when it is not a link AFCT will follow. */
export type LinkPresentation = {
  href: string;
  /** Present only for links that leave AFCT. */
  target?: '_blank';
  rel?: string;
};

/**
 * Decide how to render a stored link.
 *
 * There is no internal-link case to handle: the protocol allowlist accepts only `https:` and
 * `mailto:`, so a relative or same-app path cannot be stored in the first place and would fail
 * validation if one were hand-crafted. That leaves two real shapes:
 *
 *  - https: leaves AFCT, so it opens in a new tab with `rel` set. `noopener` denies the
 *    destination a handle on our window (the actual security control here) and `noreferrer`
 *    withholds the referrer. `nofollow` is deliberately NOT set: it is an SEO hint rather than a
 *    security control, and AFCT already sends `X-Robots-Tag: noindex, nofollow` for the whole
 *    app (see src/app/robots.ts), so per-link markup would add nothing.
 *  - mailto: hands off to a mail client. `target="_blank"` there leaves a stranded blank tab in
 *    several browsers, so it is deliberately omitted.
 */
export function describeLink(href: unknown): LinkPresentation | null {
  if (typeof href !== 'string') return null;
  const result = validateLinkUrl(href);
  if (!result.ok) return null;
  if (result.href.startsWith('mailto:')) return { href: result.href };
  return { href: result.href, target: '_blank', rel: 'noopener noreferrer' };
}
