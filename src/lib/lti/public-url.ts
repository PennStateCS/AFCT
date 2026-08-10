/**
 * AFCT's own address, as the outside world sees it.
 *
 * Anything an LMS compares or redirects to has to be built from the configured public URL, not
 * from the incoming request. AFCT runs behind nginx in production and behind a tunnel in
 * testing, so the request's host is an internal address: `localhost:3000`, not the name the
 * platform knows. A `redirect_uri` built that way is rejected by the platform, which compares it
 * literally against the registration, and a browser redirect built that way goes nowhere.
 *
 * Falls back to the request when nothing is configured, which is only the case in a bare
 * development server where the two are the same anyway.
 */
export function publicUrl(path: string, request: Request): string {
  const configured = (process.env.NEXTAUTH_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return `${configured}${path}`;
  return new URL(path, request.url).toString();
}
