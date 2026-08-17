import StoreStateClient from './StoreStateClient';

/**
 * Reached only from AFCT's own login-initiation endpoint, which builds the URL it is given.
 *
 * The authorisation URL is passed through rather than rebuilt here, and is checked against the
 * platform registrations before it is used: a page that will send a browser wherever a query
 * parameter says is an open redirect, and this one is reachable without signing in.
 */
export default async function StoreStatePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; authorize?: string; target?: string }>;
}) {
  const { state, authorize, target } = await searchParams;

  const { prisma } = await import('@/lib/prisma');
  const platforms = await prisma.ltiPlatform.findMany({ select: { authLoginUrl: true } });

  const allowed = (() => {
    if (!authorize) return null;
    let candidate: URL;
    try {
      candidate = new URL(authorize);
    } catch {
      return null;
    }
    // Same origin *and* same path as a registered authorisation endpoint. Origin alone would let
    // any path on the LMS through, which is somebody else's open redirect rather than ours.
    const match = platforms.some((platform) => {
      try {
        const registered = new URL(platform.authLoginUrl);
        return registered.origin === candidate.origin && registered.pathname === candidate.pathname;
      } catch {
        return false;
      }
    });
    return match ? candidate : null;
  })();

  if (!state || !allowed) {
    return (
      <main className="p-6 text-sm">
        This launch could not be continued. Go back to your LMS and open AFCT again.
      </main>
    );
  }

  return (
    <StoreStateClient
      state={state}
      authorizeUrl={allowed.toString()}
      storageTarget={target ?? null}
      platformOrigin={allowed.origin}
    />
  );
}
