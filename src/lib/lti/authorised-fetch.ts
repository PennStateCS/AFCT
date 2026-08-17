/**
 * Calling an LMS service endpoint with a bearer token, without silently losing the token.
 *
 * `fetch` follows redirects by default and strips the `Authorization` header whenever the
 * redirect crosses an origin, which a change of scheme does. So a platform that advertises an
 * `http://` service URL and redirects it to `https://` receives the second request with no
 * credentials and answers 401. Everything about that reads as a permissions problem: the log
 * says 401, and the obvious place to look is the LMS's own permission screens, which are
 * already correct. It cost an evening.
 *
 * Two things are done about it here. Redirects are not followed, so the token is never handed
 * to somewhere the platform did not name and never quietly dropped; and a redirect is reported
 * as itself, naming both addresses, because "your LMS pointed us somewhere else" is a sentence
 * an administrator can act on and "401" is not.
 *
 * The scheme is also repaired first, but only where the platform has already proved it speaks
 * TLS: see `preferPlatformScheme`.
 */

/** What a call failed on, when it did not reach the endpoint at all. */
export type AuthorisedFetchFailure =
  { kind: 'redirected'; from: string; to: string } | { kind: 'network'; detail: string };

export type AuthorisedFetchResult =
  { ok: true; response: Response } | { ok: false; failure: AuthorisedFetchFailure };

/**
 * An endpoint URL with `http` raised to `https`, when the platform has already shown it speaks
 * TLS on that host.
 *
 * `reference` is another URL the platform gave us, in practice its token endpoint. If a platform
 * hands out an https token URL and an http service URL on the same host, the second is a
 * misconfiguration rather than a decision.
 *
 * Deliberately narrow. Rewriting an address a platform signed is not something to do on a
 * hunch, and downgrading is never safe. But an LMS reached over TLS that advertises a plaintext
 * URL on its own hostname has misconfigured itself rather than meant it, and the redirect it
 * then serves is what destroys the credentials. Anything else is left exactly as sent.
 */
export function preferPlatformScheme(endpoint: string, reference: string): string {
  try {
    const url = new URL(endpoint);
    const referenceUrl = new URL(reference);
    if (
      url.protocol === 'http:' &&
      referenceUrl.protocol === 'https:' &&
      url.host === referenceUrl.host
    ) {
      url.protocol = 'https:';
      return url.toString();
    }
    return endpoint;
  } catch {
    // Not a URL, or not one we can compare. The caller's own error handling says so better
    // than a guess here would.
    return endpoint;
  }
}

/** A message for the person reading it, not for the developer who wrote the call. */
export function authorisedFetchFailureDetail(failure: AuthorisedFetchFailure): string {
  if (failure.kind === 'network') return failure.detail;
  return (
    `your LMS redirected AFCT from ${failure.from} to ${failure.to}, which drops the ` +
    'credentials the request carries. The address your LMS advertises for this service is ' +
    'probably http:// where it should be https://.'
  );
}

/**
 * Fetch with a bearer token, refusing to follow a redirect.
 *
 * `redirect: 'manual'` rather than `'error'` so the location can be named in the failure: the
 * whole value of catching this is being able to say where the platform tried to send us.
 */
export async function authorisedFetch(
  url: string,
  init: RequestInit & { headers: Record<string, string> },
): Promise<AuthorisedFetchResult> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: 'manual' });
  } catch (error) {
    return {
      ok: false,
      failure: {
        kind: 'network',
        detail: error instanceof Error ? error.message : 'network error',
      },
    };
  }

  // 3xx with a Location. `manual` yields an opaque-ish response whose status is still readable
  // here, since this is Node rather than a browser.
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    return {
      ok: false,
      failure: { kind: 'redirected', from: url, to: location ?? 'somewhere it did not name' },
    };
  }

  return { ok: true, response };
}
